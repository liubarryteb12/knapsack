/**
 * P0 闪退复现与定位（设备侧压测）v2
 *
 * 背景：用户报「软件老闪退」。已知 adb logcat -b crash 空、dropbox 无 data_app_crash、主 logcat 无 FATAL、
 * 纯冷启动 5 轮全部存活 → 闪退不是「一打开就死」，必须靠交互/页面/规模/生命周期压测去找触发条件。
 *
 * 判定手段（任一命中即记为崩溃信号，优先级从高到低）：
 *   1) dumpsys activity exit-info：本包进程出现 reason=4(CRASH) / 5(CRASH_NATIVE) / 6(ANR) / 7(INIT) / 9(EXCESSIVE) 的新条目
 *   2) adb shell pidof <pkg> 为空（进程消失）或 pid 变化（非本步骤主动重启）
 *   3) CDP WebSocket 意外断开（渲染进程崩溃/页面销毁）
 *   4) logcat 命中 FATAL EXCEPTION / ANR in <pkg> / RenderProcessGone / AwContents crash / signal N (SIGSEGV|SIGABRT|SIGILL|SIGBUS)
 * 另单独统计（不算崩溃，算缺陷线索）：Runtime.exceptionThrown 未捕获 JS 异常、非网络的 Log error、
 * 网络类 Log error（ERR_CONNECTION_REFUSED 等，多为无害噪音，单独计数）、triggerEvent 关键字、进程 PSS 增长。
 *
 * 退出码：0 = 未复现（覆盖矩阵完成）；1 = 复现崩溃；2 = 设备不可用。
 * 产物：scripts/out/p7-crash-<ts>.json、scripts/out/p7-crash-<ts>-<step>.png
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Cdp } from './lib/p7-cdp'
import {
  adbTry,
  ensureDevice,
  deviceInfo,
  forceStopApp,
  startApp,
  appPid,
  sleep,
  restoreNetwork,
  PKG,
  MAIN_ACTIVITY,
} from './lib/p7-adb'
import { Recorder, nowIso, clip, fileStamp } from './lib/p7-report'
import { openApp, readState, resetAndInject, gotoTeam, openTab, screenshotTo, isMain } from './lib/p7-run'
import { PAGE_LIB } from './lib/p7-page'
import { orgFixture, memFixture, payloadOf, ORG_TEAM_ID, MEM_TEAM_ID } from './lib/p7-fixtures'
import { validateTrip } from '../src/schema/trip'

const OUT_DIR = 'scripts/out'
const RUN_ID = 'p7-crash-' + fileStamp()

/**
 * 用法：
 *   npx --no-install tsx scripts/p7-crash-sweep.ts                     # 全量压测（约 12-15 分钟）
 *   npx --no-install tsx scripts/p7-crash-sweep.ts --only=launch-loop-x12,camera-scan-teams
 *   npx --no-install tsx scripts/p7-crash-sweep.ts --skip=scale-1500-trips,background-30s-1
 * --only/--skip 用步骤名前缀匹配（见文件内 step('名字', ...)），逗号分隔。
 * 步骤名一览：route:/、route:/teams、route:/settings、route:/trip/:id、route:/team/org、route:/team/mem、
 *   team-tabs-org、member-interactions、camera-scan-teams、camera-scan-member、session-start-stop-x5、
 *   share-sheet-x3、file-picker-x3、rapid-route-switch-20、long-list-200-trips、scale-1500-trips、
 *   background-30s-1、background-30s-2、rotation-landscape、rotation-restore-portrait、small-screen-360x640、
 *   launch-loop-x12、cold-start-immediate-interaction-1、cold-start-immediate-interaction-2
 * 退出码：0=未复现崩溃，1=复现崩溃，2=设备不可用。
 *
 * 渲染进程自愈（task-9 RendererRecovery）：
 *   渲染进程死亡后 WebView 会被重建 → CDP 断开、page target 换新的。脚本在每步结束后若发现
 *   CDP 断开 / pid 变化 / 渲染进程崩溃日志，会探测「新 target 出现且 .app-shell 已渲染」：
 *   · 探测成功 → 记 selfHeal.recovered=true + recoveredSignals（不算崩溃，日志打 [selfheal]）；
 *   · 探测失败（12s 内没有可用 target）→ 才记 process-gone / cdp-closed / renderer-gone 崩溃信号。
 *   注意：FATAL EXCEPTION / ANR / OOM / native signal / exit-info 崩溃类条目仍一律算崩溃，未放宽。
 */
const ARGV = process.argv.slice(2)
function argValue(name: string): string | null {
  const hit = ARGV.filter((a) => a.indexOf('--' + name + '=') === 0)[0]
  return hit ? hit.slice(name.length + 3) : null
}
const ONLY = (argValue('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const SKIP = (argValue('skip') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
function selected(name: string): boolean {
  if (SKIP.some((s) => name === s || name.indexOf(s) === 0)) return false
  if (ONLY.length === 0) return true
  return ONLY.some((s) => name === s || name.indexOf(s) === 0)
}

interface StepRecord {
  name: string
  ms: number
  pidBefore: string
  pidAfter: string
  alive: boolean
  pssKb: number | null
  cdpClosed: string | null
  error: string | null
  jsErrors: Array<Record<string, unknown>>
  networkErrors: number
  log: Record<string, number>
  logSamples: string[]
  newExits: Array<Record<string, unknown>>
  note?: string
  screenshot?: string
  /** 渲染进程自愈探测（RendererRecovery）：CDP 断开后是否换了新 page target 并恢复路由 */
  selfHeal?: { recovered: boolean; route: string | null; waitedMs: number; logLines: string[]; detail?: string }
}

interface CrashSignal {
  step: string
  kind: string
  detail: string
}

const CRASH_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'fatal', re: /FATAL EXCEPTION/ },
  { kind: 'anr', re: /ANR in com\.liubarryteb12/ },
  { kind: 'renderer-gone', re: /RenderProcessGone|render process (gone|crash)|Renderer process.*(crash|gone)/i },
  { kind: 'awcontents', re: /AwContents.*(crash|gone)/i },
  { kind: 'native-signal', re: /signal \d+ \(SIG(SEGV|ABRT|ILL|BUS)\)/ },
  // 注意：不要用 /killing.*<包名>/ —— 脚本自己 am force-stop 时 ActivityManager 也会打
  // "Killing 22444:com.liubarryteb12.knapsack ... due to from process:22672"，那是脚本主动杀的，
  // 曾被误判成 OOM 崩溃（本轮踩到）。真正的 OOM 只认 Out of memory / OOM / lowmemorykiller / lmkd。
  { kind: 'oom', re: /Out of memory|\bOOM\b|lowmemorykiller|lmkd.*(kill|low memory)/i },
]
const INFO_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'chromium', re: /chromium/i },
  { kind: 'uncaught', re: /Uncaught/ },
  { kind: 'triggerEvent', re: /triggerEvent/ },
  { kind: 'rendererRecovery', re: /RendererRecovery/ },
]
/** 渲染进程相关信号（现在由 RendererRecovery 自愈，需单独判定是否恢复） */
const RENDERER_HIT_RE = /RenderProcessGone|render process (gone|crash)|Renderer process.*(crash|gone)|AwContents.*(crash|gone)/i
/** 自愈日志里的关键行（重建次数 / 恢复路由） */
const HEAL_REBUILD_RE = /第 \d+ 次重建 Activity/
const HEAL_RESTORE_RE = /恢复路由/
const NETWORK_RE = /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_|Failed to load resource/i

function scanLog(dump: string): { counts: Record<string, number>; samples: string[]; crash: string[]; recovery: string[] } {
  const counts: Record<string, number> = {}
  const samples: string[] = []
  const crash: string[] = []
  const recovery: string[] = []
  for (const line of dump.split('\n')) {
    // 脚本自己 am force-stop 的 ActivityManager 行（Killing <pid>:<pkg> … due to from process）单独计数，不算崩溃
    if (/Killing \d+:com\.liubarryteb12\.knapsack/.test(line)) {
      counts.selfForceStop = (counts.selfForceStop ?? 0) + 1
      continue
    }
    if (line.indexOf('RendererRecovery') >= 0 && (HEAL_REBUILD_RE.test(line) || HEAL_RESTORE_RE.test(line) || line.indexOf('onRenderProcessGone') >= 0)) {
      recovery.push(clip(line, 240))
    }
    for (const p of CRASH_PATTERNS) {
      if (p.re.test(line)) {
        counts[p.kind] = (counts[p.kind] ?? 0) + 1
        crash.push(clip(line, 240))
      }
    }
    for (const p of INFO_PATTERNS) {
      if (p.re.test(line)) {
        counts[p.kind] = (counts[p.kind] ?? 0) + 1
        if (samples.length < 12 && (p.kind === 'uncaught' || p.kind === 'triggerEvent' || p.kind === 'rendererRecovery'))
          samples.push(clip(line, 240))
      }
    }
  }
  return { counts, samples, crash, recovery }
}

function parseExitInfo(text: string): Array<Record<string, any>> {
  const entries: Array<Record<string, any>> = []
  let cur: Record<string, any> | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const head = /^ApplicationExitInfo #(\d+):/.exec(line)
    if (head) {
      if (cur) entries.push(cur)
      cur = { index: Number(head[1]) }
      continue
    }
    if (!cur) continue
    const ts = /^timestamp=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+) pid=(\d+)/.exec(line)
    if (ts) {
      cur.timestamp = ts[1]
      cur.pid = ts[2]
    }
    const proc = /^process=(\S+?)(?:\s|$)/.exec(line)
    if (proc && !cur.process) cur.process = proc[1]
    const reason = /reason=(\d+) \(([^)]*)\)(?:\s+subreason=(\d+) \(([^)]*)\))?/.exec(line)
    if (reason) {
      cur.reason = Number(reason[1])
      cur.reasonText = reason[2]
      cur.subreason = reason[3] ? Number(reason[3]) : null
      cur.subreasonText = reason[4] ?? null
    }
    const imp = /importance=(\d+)/.exec(line)
    if (imp) cur.importance = Number(imp[1])
  }
  if (cur) entries.push(cur)
  return entries
}

const CRASH_REASONS: Record<number, string> = {
  4: 'CRASH(Java/进程崩溃)',
  5: 'CRASH_NATIVE(native 崩溃)',
  6: 'ANR',
  7: 'INITIALIZATION FAILURE',
  9: 'EXCESSIVE RESOURCE USAGE',
}

function readExitInfo(): { raw: string; entries: Array<Record<string, any>> } {
  const r = adbTry(['shell', 'dumpsys', 'activity', 'exit-info', PKG], { timeoutMs: 30_000 })
  const raw = r.stdout
  return { raw, entries: parseExitInfo(raw) }
}

function pssKb(): number | null {
  const r = adbTry(['shell', 'dumpsys', 'meminfo', PKG], { timeoutMs: 30_000 })
  const m = /TOTAL\s+(\d+)/.exec(r.stdout) || /TOTAL PSS:\s+(\d+)/.exec(r.stdout)
  return m ? Number(m[1]) : null
}

function putRowsExpr(store: string, rows: unknown[]): string {
  return (
    '(async () => {' +
    PAGE_LIB +
    ' const db = await p7openDb();' +
    ' const n = await p7putRows(db, ' +
    JSON.stringify(store) +
    ', ' +
    JSON.stringify(rows) +
    ');' +
    ' db.close();' +
    ' return JSON.stringify({ ok: true, count: n });' +
    ' })()'
  )
}

function clearTripsExpr(): string {
  return (
    '(async () => {' +
    PAGE_LIB +
    ' const db = await p7openDb();' +
    ' await new Promise((res, rej) => {' +
    ' const tx = db.transaction(["trips"], "readwrite");' +
    ' const rq = tx.objectStore("trips").clear();' +
    ' rq.onsuccess = () => res(1); rq.onerror = () => rej(rq.error);' +
    ' });' +
    ' db.close();' +
    ' return JSON.stringify({ cleared: true });' +
    ' })()'
  )
}

function makeTrip(i: number): Record<string, unknown> {
  const day = String((i % 28) + 1).padStart(2, '0')
  const raw = {
    format: 'trip.v1',
    id: 'p7trip' + String(i).padStart(5, '0'),
    name: 'P7 压测旅行 ' + i + '（' + '很长的名字'.repeat(1 + (i % 3)) + '）',
    startDate: '2026-11-' + day,
    endDate: '2026-11-' + day,
    destType: 'generic',
    destCity: '',
    totalBudgetFen: 0,
    categoryBudgetsFen: {},
    members: [{ id: 'p7member01', name: '我', role: 'owner' }],
    days: [],
    expenses: [],
    packing: [],
    notes: '',
    enabledModules: { expenses: true, notes: true },
  }
  return validateTrip(raw) as unknown as Record<string, unknown>
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60)
}

async function main(): Promise<number> {
  const rec = new Recorder({ script: 'p7-crash-sweep.ts', startedAt: nowIso() })
  try {
    ensureDevice()
  } catch (e) {
    const reason = '设备不可用：' + (e instanceof Error ? e.message : String(e))
    rec.blocked('P0-闪退', 'P0 闪退复现与定位（设备侧）', reason, {})
    console.log(rec.summary())
    console.log('证据文件：' + rec.write(OUT_DIR, RUN_ID))
    return 2
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const dev = deviceInfo()
  rec.meta.device = dev as unknown as Record<string, unknown>
  rec.log('[sweep] 设备：' + JSON.stringify(dev))

  const baselineExits = readExitInfo()
  const baselinePids = new Set(baselineExits.entries.map((e) => String(e.pid)))
  const baselineCrashPids = new Set(
    baselineExits.entries.filter((e) => e.process === PKG && CRASH_REASONS[e.reason]).map((e) => String(e.pid)),
  )
  rec.log('[sweep] 基线 exit-info 条目 ' + baselineExits.entries.length + ' 条，其中崩溃类 ' + baselineCrashPids.size + ' 条')
  const pssStart = pssKb()

  const results: StepRecord[] = []
  const crashSignals: CrashSignal[] = []
  /** 渲染进程崩溃但被 RendererRecovery 自愈恢复的事件（不算应用崩溃，单独记账） */
  const recoveredSignals: CrashSignal[] = []
  const exceptions: Array<Record<string, unknown>> = []
  let jsErrorTotal = 0
  let networkErrorTotal = 0

  let cdp: Cdp = await openApp({ restart: true })

  function hook(c: Cdp): void {
    c.on('Runtime.exceptionThrown', (p) => {
      const d = ((p as Record<string, unknown>).exceptionDetails ?? {}) as Record<string, any>
      exceptions.push({
        kind: 'exceptionThrown',
        text: clip(String(d.text ?? ''), 200),
        description: clip(String(d.exception?.description ?? ''), 600),
        url: d.url ?? null,
        line: d.lineNumber ?? null,
        ts: Date.now(),
      })
    })
    c.on('Log.entryAdded', (p) => {
      const e = ((p as Record<string, unknown>).entry ?? {}) as Record<string, any>
      if (e.level !== 'error') return
      const text = String(e.text ?? '')
      exceptions.push({
        kind: NETWORK_RE.test(text) ? 'logNetwork' : 'logError',
        text: clip(text, 300),
        url: clip(String(e.url ?? ''), 300),
        source: e.source ?? null,
        ts: Date.now(),
      })
    })
  }

  async function ensureCdp(): Promise<Cdp> {
    if (cdp && cdp.isOpen) return cdp
    cdp = await Cdp.attach({ waitApp: false })
    hook(cdp)
    await cdp.send('Log.enable').catch(() => undefined)
    await cdp.send('Page.enable').catch(() => undefined)
    return cdp
  }

  hook(cdp)
  await cdp.send('Log.enable').catch(() => undefined)
  await cdp.send('Page.enable').catch(() => undefined)

  /**
   * 渲染进程死后 CDP 会断开、page target 会换（WebView 重建）。这里探测「新 target 出现且页面已恢复」，
   * 恢复成功即视为自愈成功（不是崩溃）；探测不到才算崩溃信号。
   */
  /** 当前前台 Activity 的包名（取 topResumedActivity） */
  function foregroundActivity(): string {
    const r = adbTry(['shell', 'dumpsys activity activities'], { timeoutMs: 30_000 })
    const m = /topResumedActivity=[^\n]*?u0 ([A-Za-z0-9_.]+)\//.exec(r.stdout)
    return m ? m[1] : ''
  }

  /**
   * 保证应用在前台：系统选择器/分享面板/文件管理器等第三方 Activity 挡在前面时，
   * WebView 会被暂停，CDP Runtime.evaluate 会一直等到超时，压测会假性卡死（本轮就踩到了）。
   * 所以每步开始与自愈探测前都先 BACK 掉挡路的 Activity，必要时把应用拉回前台。
   */
  async function ensureAppForeground(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const act = foregroundActivity()
      if (act.indexOf(PKG) >= 0) return
      rec.log('[fg] 前台是 ' + (act || '未知') + '，按 BACK 收回')
      adbTry(['shell', 'input', 'keyevent', '4'])
      await sleep(900)
    }
    adbTry(['shell', 'am', 'start', '-n', MAIN_ACTIVITY])
    await sleep(2500)
  }

  async function probeSelfHeal(deadReason: string | null): Promise<{ recovered: boolean; route: string | null; waitedMs: number; detail?: string }> {
    const t0 = Date.now()
    // 自愈探测前先确认应用在前台：被系统选择器挡着时 evaluate 会挂到超时，24 轮会拖成十几分钟。
    await ensureAppForeground()
    for (let i = 0; i < 12; i++) {
      try {
        if (!cdp || !cdp.isOpen) {
          cdp = await Cdp.attach({ waitApp: true, timeoutMs: 8000 })
          hook(cdp)
          await cdp.send('Log.enable').catch(() => undefined)
          await cdp.send('Page.enable').catch(() => undefined)
        }
        const info = await cdp.evalJson<{ href: string; shell: boolean; ready: string }>(
          '(function () { return JSON.stringify({ href: location.href, shell: !!document.querySelector(".app-shell"), ready: document.readyState }) })()',
          { timeoutMs: 3000 },
        )
        if (info.shell) return { recovered: true, route: info.href, waitedMs: Date.now() - t0 }
      } catch {
        /* 渲染进程还没起来，继续等 */
      }
      await sleep(1000)
    }
    return { recovered: false, route: null, waitedMs: Date.now() - t0, detail: '探测窗口内未出现可用 page target（' + (deadReason ?? '原因未知') + '）' }
  }

  async function step(
    name: string,
    fn: (c: Cdp) => Promise<void>,
    opts: { settleMs?: number; screenshot?: boolean; note?: string; expectRestart?: boolean } = {},
  ): Promise<void> {
    if (!selected(name)) {
      rec.log('[step] ' + name + ' → 跳过（--only/--skip 过滤）')
      return
    }
    adbTry(['logcat', '-c'])
    const exStart = exceptions.length
    const pidBefore = appPid()
    const t0 = Date.now()
    let error: string | null = null
    let shot: string | undefined
    try {
      await ensureAppForeground()
      const c = await ensureCdp()
      await fn(c)
      if (opts.screenshot) shot = await screenshotTo(c, OUT_DIR, RUN_ID + '-' + safeName(name) + '.png').catch(() => undefined)
    } catch (e) {
      error = clip(e instanceof Error ? e.message : String(e), 600)
    }
    await sleep(opts.settleMs ?? 1200)
    const closed0 = cdp.closedReason
    let pidAfter = appPid()
    let dump = adbTry(['logcat', '-d', '-v', 'brief', '-t', '3000'], { timeoutMs: 40_000 }).stdout
    let scan = scanLog(dump)
    // 渲染进程死亡后 RendererRecovery 会重建 Activity/WebView：CDP 断开、page target 换新的。
    // 探测「新 target 出现且 .app-shell 已渲染」= 自愈成功（页面没白屏），此时不记崩溃信号；探测不到才记。
    const rendererHits = scan.crash.filter((c) => RENDERER_HIT_RE.test(c))
    const needProbe = !opts.expectRestart && (closed0 !== null || rendererHits.length > 0 || (!!pidBefore && pidAfter !== pidBefore))
    let heal: StepRecord['selfHeal']
    if (needProbe) {
      const p = await probeSelfHeal(closed0)
      heal = { recovered: p.recovered, route: p.route, waitedMs: p.waitedMs, logLines: scan.recovery.slice(0, 8), detail: p.detail }
      rec.log(
        '[selfheal] ' + name + ' → ' +
          (p.recovered
            ? '已自愈，恢复路由 ' + p.route + '（等待 ' + p.waitedMs + 'ms，自愈日志 ' + scan.recovery.length + ' 行）'
            : '未自愈：' + (p.detail ?? '')),
      )
      if (p.recovered) {
        await sleep(600)
        pidAfter = appPid()
        dump = adbTry(['logcat', '-d', '-v', 'brief', '-t', '3000'], { timeoutMs: 40_000 }).stdout
        scan = scanLog(dump)
      }
    }
    const closed = closed0 ?? cdp.closedReason
    const js = exceptions.slice(exStart)
    const jsReal = js.filter((e) => e.kind === 'exceptionThrown' || e.kind === 'logError')
    const net = js.filter((e) => e.kind === 'logNetwork')
    jsErrorTotal += jsReal.length
    networkErrorTotal += net.length
    const exits = readExitInfo().entries.filter((e) => !baselinePids.has(String(e.pid)))
    for (const e of exits) baselinePids.add(String(e.pid))
    const pss = pssKb()
    const rec0: StepRecord = {
      name,
      ms: Date.now() - t0,
      pidBefore,
      pidAfter,
      alive: pidAfter.length > 0,
      pssKb: pss,
      cdpClosed: closed,
      error,
      jsErrors: jsReal.slice(0, 8),
      networkErrors: net.length,
      log: scan.counts,
      logSamples: scan.samples,
      newExits: exits.filter((e) => e.process === PKG || String(e.process ?? '').indexOf(PKG) === 0),
      note: opts.note,
      screenshot: shot,
      selfHeal: heal,
    }
    results.push(rec0)
    rec.log(
      '[step] ' + name + ' | ' + rec0.ms + 'ms | pid ' + (pidBefore || '-') + '→' + (pidAfter || 'DEAD') +
        ' | pss ' + (pss ?? '-') + 'KB | js异常 ' + jsReal.length + ' | 网络错 ' + net.length +
        ' | log ' + JSON.stringify(scan.counts) + ' | 新退出 ' + rec0.newExits.length + (error ? ' | err ' + error : ''),
    )
    const healed = heal?.recovered === true
    if (!pidAfter) crashSignals.push({ step: name, kind: 'process-gone', detail: 'pidof 为空：进程已不在' })
    else if (pidBefore && pidAfter !== pidBefore && !opts.expectRestart && !healed)
      crashSignals.push({ step: name, kind: 'process-restarted', detail: '非预期重启 ' + pidBefore + ' → ' + pidAfter })
    if (closed0 && !opts.expectRestart && !healed) crashSignals.push({ step: name, kind: 'cdp-closed', detail: closed0 })
    // 非渲染进程类的崩溃信号（FATAL/ANR/OOM/native signal）照旧直接记崩溃
    for (const c of scan.crash.filter((x) => !RENDERER_HIT_RE.test(x)).slice(0, 3)) crashSignals.push({ step: name, kind: 'logcat', detail: c })
    // 渲染进程死亡：自愈成功则记「已自愈」，否则记崩溃
    for (const c of rendererHits.slice(0, 3)) {
      if (healed) recoveredSignals.push({ step: name, kind: 'renderer-gone-recovered', detail: c + ' → 已自愈恢复 ' + (heal?.route ?? '') + '（等待 ' + (heal?.waitedMs ?? 0) + 'ms）' })
      else crashSignals.push({ step: name, kind: 'renderer-gone', detail: c })
    }
    for (const e of rec0.newExits as Array<Record<string, any>>) {
      if (CRASH_REASONS[e.reason]) {
        crashSignals.push({ step: name, kind: 'exit-info', detail: 'pid ' + e.pid + ' reason=' + e.reason + ' ' + (CRASH_REASONS[e.reason] ?? '') + ' @' + e.timestamp })
      }
    }
  }

  // ---------- 准备 fixture ----------
  rec.log('[sweep] 注入团队 fixture + 旅行数据…')
  const org = orgFixture()
  const mem = memFixture(true)
  await resetAndInject(cdp, payloadOf(org), [ORG_TEAM_ID])
  await resetAndInject(cdp, payloadOf(mem), [MEM_TEAM_ID])
  await cdp.evalJson(clearTripsExpr())
  const trips: Record<string, unknown>[] = []
  for (let i = 0; i < 200; i++) trips.push(makeTrip(i))
  rec.log('[sweep] 旅行注入：' + JSON.stringify(await cdp.evalJson(putRowsExpr('trips', trips))))
  const state = await readState(cdp)
  rec.log('[sweep] 团队行：teams=' + state.teams.length + ' publications=' + state.publications.length + ' links=' + state.links.length)

  // ---------- 1. 逐路由停留 ----------
  const routes: Array<[string, string]> = [
    ['route:/', '#/'],
    ['route:/teams', '#/teams'],
    ['route:/settings', '#/settings'],
    ['route:/trip/:id', '#/trip/p7trip00000'],
    ['route:/team/org', '#/team/' + ORG_TEAM_ID],
    ['route:/team/mem', '#/team/' + MEM_TEAM_ID],
  ]
  for (const [name, hash] of routes) {
    await step(name, async (c) => {
      await c.goto(hash)
      await sleep(3500)
    }, { screenshot: true })
  }

  // ---------- 2. 组织者三个 tab ----------
  await step('team-tabs-org', async (c) => {
    await gotoTeam(c, ORG_TEAM_ID)
    for (const label of ['分工设置', '汇总与确认', '会话与发布']) {
      await openTab(c, label, label === '分工设置' ? '物资' : label === '汇总与确认' ? '缺口总表' : '汇总会话')
      await sleep(1500)
    }
  }, { screenshot: true })

  // ---------- 3. 成员页交互 ----------
  await step('member-interactions', async (c) => {
    await gotoTeam(c, MEM_TEAM_ID)
    await sleep(1200)
    await c.clickText('领取最新版').catch(() => false)
    await sleep(1500)
    await c.clickText('上报').catch(() => false)
    await sleep(1200)
    await c.clickText('取消').catch(() => false)
    await sleep(600)
    await c.clickText('刷新状态').catch(() => false)
    await sleep(1500)
  }, { screenshot: true })

  // ---------- 4. 相机扫码（html5-qrcode 动态导入 + getUserMedia） ----------
  await step('camera-scan-teams', async (c) => {
    await c.goto('#/teams')
    await sleep(1500)
    await c.clickText('扫码加入').catch(() => false)
    await sleep(1500)
    const opened = await c.clickText('扫描组织者屏幕上的会话码').catch(() => false)
    if (!opened) rec.log('[step] camera-scan-teams：未找到「扫描组织者屏幕上的会话码」按钮')
    await sleep(8000)
    const text = await c.text().catch(() => '')
    rec.log('[step] camera-scan-teams：扫码界面出现=' + (text.indexOf('取消扫码') >= 0) + '，含扫码失败提示=' + (text.indexOf('扫码失败') >= 0))
    await c.clickText('取消扫码').catch(() => false)
    await sleep(1000)
    await c.clickText('取消').catch(() => false)
    await sleep(800)
  }, { screenshot: true, settleMs: 2000 })

  await step('camera-scan-member', async (c) => {
    await gotoTeam(c, MEM_TEAM_ID)
    await sleep(1200)
    const opened = await c.clickText('扫描组织者屏幕上的会话码').catch(() => false)
    if (!opened) rec.log('[step] camera-scan-member：未找到扫码按钮')
    await sleep(8000)
    const text = await c.text().catch(() => '')
    rec.log('[step] camera-scan-member：扫码界面出现=' + (text.indexOf('取消扫码') >= 0) + '，含扫码失败提示=' + (text.indexOf('扫码失败') >= 0))
    await c.clickText('取消扫码').catch(() => false)
    await sleep(1000)
  }, { screenshot: true, settleMs: 2000 })

  // ---------- 5. 会话说启停 5 轮（原生 TeamHost 插件） ----------
  await step('session-start-stop-x5', async (c) => {
    await gotoTeam(c, ORG_TEAM_ID)
    await openTab(c, '会话与发布', '汇总会话')
    for (let i = 0; i < 5; i++) {
      await c.clickText('开启会话').catch(() => false)
      await sleep(2000)
      await c.clickText('停止').catch(() => false)
      await sleep(1200)
    }
  }, { screenshot: true })

  // ---------- 6. 系统分享面板 3 轮（Filesystem + Share 插件） ----------
  await step('share-sheet-x3', async (c) => {
    await gotoTeam(c, ORG_TEAM_ID)
    await openTab(c, '会话与发布', '汇总会话')
    for (let i = 0; i < 3; i++) {
      await c.clickText('导出资料文件').catch(() => false)
      await sleep(3000)
      adbTry(['shell', 'input', 'keyevent', '4'])
      await sleep(1500)
    }
  }, { settleMs: 1500, note: '系统分享面板每轮 BACK 收回' })

  // ---------- 7. 系统文件选择器 3 轮 ----------
  await step('file-picker-x3', async (c) => {
    await gotoTeam(c, MEM_TEAM_ID)
    for (let i = 0; i < 3; i++) {
      await sleep(1000)
      await c.clickText('导入文件').catch(() => false)
      await sleep(3000)
      adbTry(['shell', 'input', 'keyevent', '4'])
      await sleep(1500)
    }
  }, { settleMs: 1500, note: '系统文件选择器每轮 BACK 收回' })

  // ---------- 8. 快速切路由 ----------
  await step('rapid-route-switch-20', async (c) => {
    const seq = ['#/', '#/teams', '#/settings', '#/teams', '#/team/' + ORG_TEAM_ID, '#/', '#/trip/p7trip00001', '#/teams']
    for (let i = 0; i < 20; i++) {
      await c.evalRaw('(function(){ location.hash = ' + JSON.stringify(seq[i % seq.length]) + '; return true })()').catch(() => undefined)
      await sleep(150)
    }
    await sleep(2500)
  }, { screenshot: true })

  // ---------- 9. 长列表 ----------
  await step('long-list-200-trips', async (c) => {
    await c.goto('#/')
    await sleep(1500)
    for (let i = 0; i < 8; i++) {
      await c.evalRaw('(function(){ window.scrollBy(0, window.innerHeight * 2); return true })()').catch(() => undefined)
      await sleep(350)
    }
    await c.evalRaw('(function(){ window.scrollTo(0, 0); return true })()').catch(() => undefined)
    await sleep(1000)
  }, { screenshot: true })

  // ---------- 10. 规模压测：1500 条旅行 + 45s 路由抖动 + PSS 采样 ----------
  await step('scale-1500-trips', async (c) => {
    const more: Record<string, unknown>[] = []
    for (let i = 200; i < 1700; i++) more.push(makeTrip(i))
    const put = await c.evalJson<Record<string, unknown>>(putRowsExpr('trips', more))
    rec.log('[step] scale-1500-trips：注入 ' + JSON.stringify(put) + '，PSS ' + (pssKb() ?? '-') + 'KB')
    await c.goto('#/')
    await sleep(2000)
    const samples: number[] = []
    const t0 = Date.now()
    let k = 0
    while (Date.now() - t0 < 45_000) {
      const hash = k % 3 === 0 ? '#/' : k % 3 === 1 ? '#/trip/p7trip00100' : '#/teams'
      await c.evalRaw('(function(){ location.hash = ' + JSON.stringify(hash) + '; return true })()').catch(() => undefined)
      await sleep(700)
      if (k % 6 === 0) {
        const m = pssKb()
        if (m) samples.push(m)
      }
      k += 1
    }
    rec.log('[step] scale-1500-trips：' + k + ' 次切换，PSS 采样 ' + JSON.stringify(samples))
  }, { settleMs: 2000, screenshot: true })

  // ---------- 11. 后台 30s 再回前台 ----------
  for (let i = 1; i <= 2; i++) {
    await step('background-30s-' + i, async () => {
      await gotoTeam(cdp, ORG_TEAM_ID)
      adbTry(['shell', 'input', 'keyevent', '3'])
      await sleep(30_000)
      startApp()
      await sleep(3000)
    }, { settleMs: 2500, screenshot: i === 2 })
  }

  // ---------- 12. 旋转 ----------
  await step('rotation-landscape', async (c) => {
    adbTry(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'])
    adbTry(['shell', 'settings', 'put', 'system', 'user_rotation', '1'])
    await sleep(4000)
    await gotoTeam(c, ORG_TEAM_ID)
    await sleep(2000)
    await c.goto('#/teams')
    await sleep(2000)
  }, { screenshot: true })
  await step('rotation-restore-portrait', async () => {
    adbTry(['shell', 'settings', 'put', 'system', 'user_rotation', '0'])
    await sleep(2500)
    adbTry(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1'])
    await sleep(1500)
  }, { settleMs: 1500 })

  // ---------- 13. 小屏 ----------
  await step('small-screen-360x640', async (c) => {
    await c.setDeviceMetrics({ width: 360, height: 640, deviceScaleFactor: 3, mobile: true })
    await c.goto('#/teams')
    await sleep(1500)
    await gotoTeam(c, ORG_TEAM_ID)
    await sleep(1500)
    await c.setDeviceMetrics(null)
    await sleep(1200)
  }, { screenshot: true })

  // ---------- 14. 连续冷启动 12 轮（捕捉启动竞态/启动即崩） ----------
  await step('launch-loop-x12', async () => {
    for (let i = 0; i < 12; i++) {
      forceStopApp()
      await sleep(300)
      startApp()
      await sleep(2500)
      const pid = appPid()
      if (!pid) {
        rec.log('[step] launch-loop-x12：第 ' + (i + 1) + ' 轮启动后进程不存在')
        break
      }
    }
  }, { settleMs: 1500, expectRestart: true, screenshot: true })

  // ---------- 15. 冷启动后立刻交互（不等页面 ready） ----------
  for (let i = 1; i <= 2; i++) {
    await step('cold-start-immediate-interaction-' + i, async () => {
      cdp.close()
      forceStopApp()
      await sleep(400)
      startApp()
      cdp = await Cdp.attach({ waitApp: false, timeoutMs: 20_000 })
      hook(cdp)
      await cdp.send('Log.enable').catch(() => undefined)
      for (let k = 0; k < 6; k++) {
        await cdp.evalRaw('(function(){ location.hash = ' + JSON.stringify(k % 2 === 0 ? '#/teams' : '#/') + '; return true })()', { timeoutMs: 4000 }).catch(() => undefined)
        await sleep(120)
      }
      await sleep(2500)
    }, { settleMs: 2500, expectRestart: true, screenshot: i === 2 })
  }

  // ---------- 收尾 ----------
  let finalState: Record<string, unknown> = {}
  try {
    const c = await ensureCdp()
    const text = await c.text()
    finalState = { alive: appPid() !== '', hasShell: text.length > 0, textSample: clip(text, 200) }
  } catch (e) {
    finalState = { alive: appPid() !== '', error: clip(String(e), 400) }
  }
  const pssEnd = pssKb()
  const finalExits = readExitInfo()
  const newCrashExits = finalExits.entries.filter((e) => e.process === PKG && CRASH_REASONS[e.reason] && !baselineCrashPids.has(String(e.pid)))
  const restored = (() => {
    try {
      return restoreNetwork()
    } catch (e) {
      return ['恢复失败：' + String(e)]
    }
  })()

  const uncovered = [
    '三设备现场样例（甲主机/乙采购/丙携带同时在线）—— 只有 1 台设备',
    '真实二维码对准与真实相机画面（本次只验证扫码界面能打开、能释放摄像头）',
    '锁屏/息屏后台（R09/R10）—— 未测',
    '超长时间运行（>30 分钟）与真实低内存/DO 压力',
    '其它机型与其它 WebView 版本（本机 WebView 116.0.5845.92）',
    '真实系统分享面板里的具体目标应用、系统文件选择器里真实选取文件',
  ]

  const evidence = {
    runId: RUN_ID,
    device: dev,
    startedAt: rec.meta.startedAt,
    steps: results,
    crashSignals,
    recoveredSignals,
    jsErrorTotal,
    networkErrorTotal,
    exceptions: exceptions.slice(0, 40),
    pss: { start: pssStart, end: pssEnd },
    baselineExits: baselineExits.entries.slice(0, 8),
    finalExits: finalExits.entries.slice(0, 12),
    newCrashExits,
    finalState,
    networkRestore: restored,
    uncovered,
    reproductionSteps: crashSignals.length > 0 ? crashSignals.map((s) => s.step + ' → ' + s.kind + '：' + s.detail) : [],
  }
  const evidencePath = OUT_DIR + '/' + RUN_ID + '.json'
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8')
  rec.log('[sweep] 证据：' + evidencePath)

  if (crashSignals.length > 0) {
    const byStep = new Map<string, CrashSignal[]>()
    for (const s of crashSignals) {
      const arr = byStep.get(s.step) ?? []
      arr.push(s)
      byStep.set(s.step, arr)
    }
    const brief = Array.from(byStep.entries())
      .map(([stepName, sigs]) => stepName + '（' + sigs.map((x) => x.kind).join('/') + '）')
      .join('；')
    rec.fail('P0-闪退', 'P0 闪退复现与定位（设备侧）', '已复现崩溃信号：' + brief, { ...evidence, evidencePath })
  } else {
    rec.pass('P0-闪退', 'P0 闪退复现与定位（设备侧）', {
      ...evidence,
      evidencePath,
      conclusion:
        '本次 ' + results.length + ' 个压测步骤全部存活：无进程消失/无未恢复的渲染进程崩溃/无 FATAL/无 ANR/exit-info 无崩溃类新条目；' +
        (recoveredSignals.length > 0
          ? '渲染进程崩溃 ' + recoveredSignals.length + ' 次但均被 RendererRecovery 自愈（重建 Activity 并恢复路由，页面未白屏）：' +
            recoveredSignals.map((s) => s.step).join('、') + '；'
          : '渲染进程未崩溃（RendererRecovery 未触发）；') +
        '未捕获 JS 异常 ' + jsErrorTotal + ' 条（网络类噪音 ' + networkErrorTotal + ' 条）；PSS ' + (pssStart ?? '-') + 'KB → ' + (pssEnd ?? '-') + 'KB。',
    })
  }

  console.log(rec.summary())
  console.log('证据文件：' + evidencePath)
  return rec.exitCode
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code))
}
