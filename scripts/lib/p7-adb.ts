/**
 * P7 单机真机验收 · adb / 设备侧工具（只新增脚本，不改应用代码）
 *
 * 统一封装：设备信息、应用重启、CDP 端口转发、截图、run-as 读写应用私有文件、
 * 网络开关（必须成对恢复）。所有失败都抛错或返回 { code, stderr } 供调用方判定，
 * 不吞错、不伪造成功。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const PKG = 'com.liubarryteb12.knapsack'
export const MAIN_ACTIVITY = PKG + '/.MainActivity'
export const DEFAULT_DEVICE = '3a3e1f52'
export const APP_FILES_DIR = '/data/user/0/' + PKG + '/files'
export const APP_CACHE_DIR = '/data/user/0/' + PKG + '/cache'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 执行 adb，返回退出码与输出，不抛错 */
export function adbTry(
  args: string[],
  opts: { input?: string; timeoutMs?: number } = {},
): RunResult {
  const res = spawnSync('adb', args, {
    encoding: 'utf8',
    input: opts.input,
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const spawnErr = res.error ? String(res.error) : ''
  return {
    code: res.status === null ? -1 : res.status,
    stdout: String(res.stdout ?? ''),
    stderr: String(res.stderr ?? '') + spawnErr,
  }
}

/** 执行 adb，非 0 退出码直接抛错 */
export function adb(args: string[], opts: { input?: string; timeoutMs?: number } = {}): string {
  const r = adbTry(args, opts)
  if (r.code !== 0) {
    throw new Error('adb ' + args.join(' ') + ' 失败(exit ' + r.code + ')：' + (r.stderr.trim() || r.stdout.trim()))
  }
  return r.stdout
}

export interface DeviceInfo {
  serial: string
  model: string
  device: string
  androidRelease: string
  sdk: string
  webview: string
  appVersionName: string
  appVersionCode: string
  lastUpdateTime: string
}

function prop(name: string): string {
  const r = adbTry(['shell', 'getprop', name])
  return r.stdout.trim()
}

/** 确认目标设备在线；返回序列号 */
export function ensureDevice(preferred?: string): string {
  const out = adbTry(['devices']).stdout
  const serials = out
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0])
  if (serials.length === 0) throw new Error('没有在线 Android 设备（adb devices 为空）')
  const want = preferred || process.env.P7_DEVICE || ''
  if (want && serials.includes(want)) return want
  if (want && !serials.includes(want)) {
    throw new Error('指定设备 ' + want + ' 不在线；当前在线：' + serials.join(','))
  }
  if (serials.length > 1 && serials.includes(DEFAULT_DEVICE)) return DEFAULT_DEVICE
  return serials[0]
}

export function deviceInfo(): DeviceInfo {
  const dumpsys = adbTry(['shell', 'dumpsys', 'package', PKG]).stdout
  const grab = (re: RegExp): string => {
    const m = dumpsys.match(re)
    return m ? (m[1] ?? '').trim() : ''
  }
  const webviewDump = adbTry(['shell', 'dumpsys', 'webviewupdate']).stdout
  const wv = webviewDump.match(/Current WebView package[^:]*:\s*\(([^)]*)\)/)
  return {
    serial: adbTry(['get-serialno']).stdout.trim(),
    model: prop('ro.product.model'),
    device: prop('ro.product.device'),
    androidRelease: prop('ro.build.version.release'),
    sdk: prop('ro.build.version.sdk'),
    webview: wv ? wv[1] : '未知',
    appVersionName: grab(/versionName=([^\s]+)/),
    appVersionCode: grab(/versionCode=(\d+)/),
    lastUpdateTime: grab(/lastUpdateTime=([^\n]+)/),
  }
}

export function forceStopApp(): void {
  adb(['shell', 'am', 'force-stop', PKG])
}

/** 启动应用并等到 Activity 报告已启动（不等待 WebView 就绪） */
export function startApp(): string {
  const r = adbTry(['shell', 'am', 'start', '-W', '-n', MAIN_ACTIVITY], { timeoutMs: 45_000 })
  return r.stdout + r.stderr
}

export function appPid(): string {
  const r = adbTry(['shell', 'pidof', PKG])
  return r.stdout.trim()
}

export async function restartApp(settleMs = 2500): Promise<void> {
  forceStopApp()
  await sleep(600)
  startApp()
  await sleep(settleMs)
}

/** 找到应用 WebView 的 devtools socket（排除系统浏览器） */
export function findDevtoolsSocket(): string {
  const out = adb(['shell', 'cat', '/proc/net/unix'])
  const lines = out.split(/\r?\n/).filter((l) => l.includes('@webview_devtools_remote_'))
  if (lines.length === 0) throw new Error('未找到应用 WebView 调试 socket（应用是否在前台、是否 debug 构建）')
  const names = lines
    .map((l) => {
      const m = l.match(/@(webview_devtools_remote_\d+)/)
      return m ? m[1] : ''
    })
    .filter(Boolean)
  if (names.length === 0) throw new Error('无法解析 webview devtools socket 名')
  return names[names.length - 1]
}

/** 清理可能残留的 9222 转发（上一个脚本中断时会留下） */
export function clearCdpForward(): void {
  adbTry(['forward', '--remove', 'tcp:9222'])
}

export function forwardCdp(): { socket: string } {
  clearCdpForward()
  const socket = findDevtoolsSocket()
  const r = adbTry(['forward', 'tcp:9222', 'localabstract:' + socket])
  if (r.code !== 0) throw new Error('adb forward tcp:9222 失败：' + r.stderr.trim())
  return { socket }
}

/** 设备截图（先试 exec-out，失败回退 shell + pull），返回写入的路径 */
export function screencapTo(path: string): string {
  mkdirSync(dirname(path), { recursive: true })
  const res = spawnSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
  const buf = res.stdout
  if (res.status === 0 && buf && buf.length > 100 && buf[0] === 0x89 && buf[1] === 0x50) {
    writeFileSync(path, buf)
    return path
  }
  const remote = '/sdcard/p7-screencap.png'
  adb(['shell', 'screencap', '-p', remote])
  const pull = adbTry(['pull', remote, path])
  adbTry(['shell', 'rm', '-f', remote])
  if (pull.code !== 0) throw new Error('设备截图失败：' + pull.stderr.trim())
  return path
}

/** run-as 读取应用私有文件（debug 构建可用） */
export function runAsRead(remotePath: string): RunResult {
  return adbTry(['shell', 'run-as', PKG, 'cat', remotePath])
}

/** run-as 写入应用私有文件（debug 构建可用）；内容走 stdin，避免引号转义 */
export function runAsWrite(remotePath: string, content: string): RunResult {
  return adbTry(['shell', 'run-as', PKG, 'tee', remotePath], { input: content })
}

export function runAsExists(remotePath: string): boolean {
  const r = adbTry(['shell', 'run-as', PKG, 'ls', remotePath])
  return r.code === 0 && !r.stderr.includes('No such file')
}

// ---------- 网络开关：调用方必须保证恢复 ----------

export function getAirplaneMode(): string {
  return adbTry(['shell', 'settings', 'get', 'global', 'airplane_mode_on']).stdout.trim()
}

/** 返回实际使用的方式与结果；失败时返回 { ok:false, detail } 供上层判定 */
export function setAirplaneMode(on: boolean): { ok: boolean; detail: string } {
  const r = adbTry(['shell', 'cmd', 'connectivity', 'airplane-mode', on ? 'enable' : 'disable'])
  if (r.code === 0) {
    const v = getAirplaneMode()
    return { ok: v === (on ? '1' : '0'), detail: 'cmd connectivity airplane-mode ' + (on ? 'enable' : 'disable') + ' → airplane_mode_on=' + v }
  }
  // 回退：svc wifi/data
  const w = setWifi(!on)
  const d = setData(!on)
  return {
    ok: w.ok && d.ok,
    detail: '回退 svc wifi ' + (!on ? 'enable' : 'disable') + ' / svc data ' + (!on ? 'enable' : 'disable') + '：' + w.detail + '；' + d.detail,
  }
}

export function setWifi(on: boolean): { ok: boolean; detail: string } {
  const r = adbTry(['shell', 'svc', 'wifi', on ? 'enable' : 'disable'], { timeoutMs: 30_000 })
  return { ok: r.code === 0, detail: 'svc wifi ' + (on ? 'enable' : 'disable') + ' exit=' + r.code + (r.stderr.trim() ? ' ' + r.stderr.trim() : '') }
}

export function setData(on: boolean): { ok: boolean; detail: string } {
  const r = adbTry(['shell', 'svc', 'data', on ? 'enable' : 'disable'], { timeoutMs: 30_000 })
  return { ok: r.code === 0, detail: 'svc data ' + (on ? 'enable' : 'disable') + ' exit=' + r.code + (r.stderr.trim() ? ' ' + r.stderr.trim() : '') }
}

/** 兜底恢复网络（脚本任何分支退出前都调用） */
export function restoreNetwork(): string[] {
  const out: string[] = []
  out.push(setAirplaneMode(false).detail)
  out.push(setWifi(true).detail)
  out.push(setData(true).detail)
  return out
}

/** 最近 logcat（用于失败时附证据） */
export function logcatTail(lines = 40, filter?: string): string {
  const args = ['logcat', '-d', '-t', String(lines)]
  if (filter) args.push('-s', filter)
  const r = adbTry(args, { timeoutMs: 30_000 })
  return r.stdout.trim()
}
