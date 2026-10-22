/**
 * A34 真机复验：走**真实系统文件选择器**导入第 2 版（task-10 第 2 项）
 *
 * 与 p7-a34-file.ts 的区别：那里用 CDP 拦截文件选择器（Page.setInterceptFileChooserDialog + DOM.setFileInputFiles），
 * 没有真正点系统 UI；本脚本不拦截，点「导入文件」后由 Capacitor 拉起系统 DocumentsUI，
 * 用 adb uiautomator dump + input tap 在真实选择器里点选文件，再由 WebView 把 content:// 读成 File 交给应用，
 * 完整走 pickTextFile → checkPublicImport → 预览 → 「导入」→ ingestPublication 的应用链路。
 *
 * 判定：全链路成功 → A34 通过（附证据）；选择器无法被自动点选 → A34 无法执行（附真实 UI dump 与原因），不伪造通过。
 * 用法：npx --no-install tsx scripts/p7-a34-picker.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { Cdp } from './lib/p7-cdp'
import { adb, adbTry, ensureDevice, deviceInfo, sleep } from './lib/p7-adb'
import { Recorder, requireTrue, nowIso, clip } from './lib/p7-report'
import { openApp, readState, teamSnapshot, resetAndInject, gotoTeam, screenshotTo, isMain } from './lib/p7-run'
import { memFixture, MEM_TEAM_ID, payloadOf } from './lib/p7-fixtures'
import { TOASTS_EXPR } from './lib/p7-page'

const OUT_DIR = 'scripts/out'
const RUN_ID = 'p7-a34-picker-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
const LOCAL_DIR = OUT_DIR + '/tmp'
const DL_DIR = '/sdcard/Download'
const FILE_JSON = 'p7-import-v2.json'
const FILE_EXT = 'p7-import-v2.team-public'
const UI_XML = '/sdcard/p7ui.xml'

const TITLE = 'Android 系统「选择文件」真实往返（导入第 2 版）'

interface UiNode {
  text: string
  desc: string
  cls: string
  bounds: string
  center: { x: number; y: number } | null
  clickable: boolean
}

function parseBounds(b: string): { x: number; y: number } | null {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(b)
  if (!m) return null
  const x1 = Number(m[1])
  const y1 = Number(m[2])
  const x2 = Number(m[3])
  const y2 = Number(m[4])
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
}

function uiDump(): { xml: string; nodes: UiNode[]; error?: string } {
  const d = adbTry(['shell', 'uiautomator', 'dump', UI_XML], { timeoutMs: 30_000 })
  if (d.code !== 0) return { xml: '', nodes: [], error: clip('uiautomator dump exit=' + d.code + ' ' + d.stderr, 300) }
  const cat = adbTry(['shell', 'cat', UI_XML], { timeoutMs: 30_000 })
  const xml = cat.stdout
  const nodes: UiNode[] = []
  const re = /<node\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0]
    const attr = (name: string): string => {
      const mm = new RegExp(name + '="([^"]*)"').exec(tag)
      return mm ? mm[1] : ''
    }
    const bounds = attr('bounds')
    nodes.push({
      text: attr('text'),
      desc: attr('content-desc'),
      cls: attr('class'),
      bounds,
      center: parseBounds(bounds),
      clickable: attr('clickable') === 'true',
    })
  }
  return { xml, nodes }
}

function tap(node: UiNode): void {
  if (!node.center) throw new Error('节点没有可点坐标：' + node.bounds)
  adb(['shell', 'input', 'tap', String(node.center.x), String(node.center.y)], { timeoutMs: 30_000 })
}

function foregroundActivity(): string {
  const r = adbTry(['shell', 'dumpsys', 'activity', 'activities'], { timeoutMs: 40_000 })
  const line = r.stdout.split('\n').find((l) => /(?:top)?[Rr]esumedActivity/.test(l)) ?? ''
  const m = /([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/.exec(line)
  return m ? m[1] : clip(line.trim(), 120)
}

/**
 * 在真实系统选择器里点选目标文件。
 * 实测（Android 13 / MIUI，DocumentsUI PickActivity）：默认停在「最近」，push 进去的文件不会被 MediaStore 索引，
 * 所以是「无任何文件」；点「文件管理」→ 进入 MIUI 文件管理器（选择文件模式）→「内部存储设备」→ 滚动到 Download
 * → 点开 → 点 p7-import-v2.json → 若出现「确定」再点确定。全程只用 adb input tap/swipe 驱动真实 UI。
 */
function pickFileInPicker(rec: Recorder): { tapped: string | null; dumps: Array<Record<string, any>> } {
  const dumps: Array<Record<string, any>> = []
  const label = (n: UiNode): string => (n.text || n.desc || '').trim()
  const navRules: Array<{ re: RegExp; what: string }> = [
    { re: /^(Download|Downloads|下载)$/, what: '下载目录' },
    { re: /^(文件管理|Files)$/, what: '文件管理 provider' },
    { re: /^(内部存储设备|内部存储|手机存储|设备存储|Internal storage)$/, what: '内部存储根' },
  ]
  const visited = new Set<string>()
  for (let round = 0; round < 24; round++) {
    const d = uiDump()
    const nodes = d.nodes.filter((n) => n.text || n.desc)
    dumps.push({ round, error: d.error ?? null, activity: foregroundActivity(), nodes: nodes.slice(0, 45).map((n) => clip(label(n) + ' ' + n.bounds, 120)) })

    const act = foregroundActivity()
    if (act.indexOf('knapsack') >= 0) {
      rec.log('[picker] 第 ' + round + ' 轮已回到应用（选择器关闭），停止导航')
      dumps.push({ round, activity: act, nodes: [], note: 'picker closed' })
      return { tapped: null, dumps }
    }

    // 1) 看到目标文件 → 点选（部分文件管理器选中后还要点「确定」）
    const hit = nodes.find((n) => /p7-import-v2/.test(label(n)))
    if (hit) {
      rec.log('[picker] 第 ' + round + ' 轮找到目标文件：' + label(hit) + ' @' + hit.bounds)
      tap(hit)
      sleep(1500)
      const after = uiDump().nodes.filter((n) => n.text || n.desc)
      const okBtn = after.find((n) => /^(确定|打开|选择|完成)$/.test(label(n)))
      if (okBtn) {
        rec.log('[picker] 点「' + label(okBtn) + '」确认选择')
        tap(okBtn)
      }
      return { tapped: label(hit), dumps }
    }

    // 2) 导航到目录
    let navigated = false
    for (const rule of navRules) {
      const n = nodes.find((x) => rule.re.test(label(x)))
      // 注意：进入目录后顶部会出现同名面包屑（内部存储设备/Download），只能按规则名去重一次，
      // 否则会反复点面包屑把列表滚回顶部（v2 就卡在这里）。
      const key = rule.what
      if (n && !visited.has(key)) {
        visited.add(key)
        rec.log('[picker] 第 ' + round + ' 轮点「' + label(n) + '」（' + rule.what + '）@' + n.bounds)
        tap(n)
        navigated = true
        sleep(1700)
        break
      }
    }
    if (navigated) continue

    // 3) 没有可点的导航项 → 上滑找（Download 在字母序靠后，需要滚动）
    rec.log('[picker] 第 ' + round + ' 轮无导航项，上滑滚动')
    adbTry(['shell', 'input', 'swipe', '540', '1700', '540', '1150', '250'], { timeoutMs: 20_000 })
    sleep(1200)
  }
  return { tapped: null, dumps }
}

export async function runA34Picker(rec: Recorder, outDir: string): Promise<void> {
  const ev: Record<string, any> = {}
  let cdp: Cdp | null = null
  let done = false
  try {
    const serial = ensureDevice()
    ev.adbSerial = serial
    ev.device = deviceInfo()
    mkdirSync(LOCAL_DIR, { recursive: true })

    const mem = memFixture(true)
    const fileText = mem.fileV2Text

    // ---------- 1) 把文件放到系统「下载」目录（用户可达位置） ----------
    const localJson = LOCAL_DIR + '/' + FILE_JSON
    writeFileSync(localJson, fileText, 'utf8')
    const push1 = adbTry(['push', localJson, DL_DIR + '/' + FILE_JSON], { timeoutMs: 60_000 })
    const push2 = adbTry(['push', localJson, DL_DIR + '/' + FILE_EXT], { timeoutMs: 60_000 })
    // 内部存储根目录也会被文件管理器列出（实测根目录直接列文件），放一份带 0- 前缀的副本便于快速定位：
    // 选择器里的排序是字母序，'0-' 排在数字/大写之前，进入根目录第一屏就能看到。
    const push3 = adbTry(['push', localJson, '/sdcard/0-' + FILE_JSON], { timeoutMs: 60_000 })
    adbTry(['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + DL_DIR + '/' + FILE_JSON], { timeoutMs: 30_000 })
    adbTry(['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + DL_DIR + '/' + FILE_EXT], { timeoutMs: 30_000 })
    const ls = adbTry(['shell', 'ls', '-l', DL_DIR], { timeoutMs: 30_000 })
    const lsRoot = adbTry(['shell', 'ls', '-l', '/sdcard'], { timeoutMs: 30_000 })
    ev.pushed = {
      json: { code: push1.code, stderr: clip(push1.stderr, 200) },
      teamPublic: { code: push2.code, stderr: clip(push2.stderr, 200) },
      rootCopy: { code: push3.code, stderr: clip(push3.stderr, 200) },
      listing: clip(ls.stdout.split('\n').filter((l) => /p7-import-v2/.test(l)).join('\n'), 400),
      rootListing: clip(lsRoot.stdout.split('\n').filter((l) => /p7-import-v2/.test(l)).join('\n'), 400),
    }
    requireTrue(push1.code === 0, 'adb push 到 /sdcard/Download 失败：' + clip(push1.stderr, 300))
    requireTrue(/p7-import-v2\.json/.test(ls.stdout), '/sdcard/Download 里看不到 p7-import-v2.json')

    // ---------- 2) 进成员页，注入 v1 fixture（导入 v2 才算「更新」） ----------
    cdp = await openApp({ restart: true })
    await resetAndInject(cdp, payloadOf(mem), [MEM_TEAM_ID])
    await gotoTeam(cdp, MEM_TEAM_ID)
    const before = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
    ev.beforeImport = before
    requireTrue(before.latestVersion === 1, '导入前本地版本应为 1，实际 ' + before.latestVersion)
    ev.screenshotBefore = await screenshotTo(cdp, outDir, RUN_ID + '-before.png')

    // ---------- 3) 点应用里的「导入文件」→ 系统选择器弹出（不拦截） ----------
    adbTry(['logcat', '-c'])
    const clicked = await cdp.clickText('导入文件')
    ev.clickedImportButton = clicked
    requireTrue(clicked, '没找到「导入文件」按钮')
    sleep(3000)
    const pickerActivity = foregroundActivity()
    ev.pickerActivity = pickerActivity
    const firstDump = uiDump()
    ev.pickerUiFirst = firstDump.nodes.filter((n) => n.text || n.desc).slice(0, 25).map((n) => clip(n.text || n.desc, 80))
    ev.pickerUiError = firstDump.error ?? null
    rec.log('[a34] 点「导入文件」后前台 Activity = ' + (pickerActivity || '(未知)'))

    // ---------- 4) 在真实选择器里点选文件 ----------
    const picked = pickFileInPicker(rec)
    ev.pickerTapped = picked.tapped
    ev.pickerDumps = picked.dumps.slice(0, 6)
    requireTrue(picked.tapped !== null, '未能在系统文件选择器里自动点选到 p7-import-v2（真实 UI 见 pickerDumps）')

    // ---------- 5) 回到应用：预览弹窗 ----------
    let previewOk = false
    let previewText = ''
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      const t = await cdp.text().catch(() => '')
      if (t.indexOf('导入公共资料文件') >= 0) {
        previewText = t
        previewOk = t.indexOf('第 2 版') >= 0 && t.indexOf('比本机版本新，可导入') >= 0
        break
      }
    }
    ev.previewOk = previewOk
    ev.previewText = clip(previewText, 900)
    ev.screenshotPreview = await screenshotTo(cdp, outDir, RUN_ID + '-preview.png')
    requireTrue(previewText.length > 0, '点选文件后应用没有出现导入预览弹窗（系统选择器→WebView 的 File 读取链路未打通）')
    requireTrue(previewOk, '预览内容不符合预期（应含「第 2 版」与「比本机版本新，可导入」）：' + clip(previewText, 600))

    // 预览阶段不应改库
    const midState = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
    ev.stateAtPreview = midState
    requireTrue(midState.latestVersion === 1, '仅预览阶段本地版本不应变化，实际 ' + midState.latestVersion)

    // ---------- 6) 点「导入」→ 应用真实入库 ----------
    const clickImport = await cdp.clickText('导入')
    ev.clickedConfirmImport = clickImport
    requireTrue(clickImport, '预览弹窗里没找到「导入」按钮')
    const seenToasts: string[] = []
    let imported = false
    let errorToast = ''
    for (let i = 0; i < 40; i++) {
      const toasts = await cdp.evalJson<string[]>(TOASTS_EXPR).catch(() => [] as string[])
      for (const t of toasts) if (seenToasts.indexOf(t) < 0) seenToasts.push(t)
      const pageText = await cdp.text().catch(() => '')
      if (seenToasts.some((t) => t.indexOf('已导入第 2 版') >= 0) || pageText.indexOf('已导入第 2 版') >= 0) {
        imported = true
        break
      }
      const bad = seenToasts.find((t) => /失败|错误|不一致|拒绝|属于另一个团队|无法|DataClone/i.test(t))
      if (bad) {
        errorToast = bad
        break
      }
      await sleep(300)
    }
    ev.toasts = seenToasts
    ev.errorToast = errorToast
    ev.imported = imported
    const after = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
    ev.afterImport = after
    const uiAfter = await cdp.text().catch(() => '')
    ev.uiAfterImport = {
      savedV2: uiAfter.indexOf('本机保存：第 2 版') >= 0,
      hasV1: uiAfter.indexOf('本机保存：第 1 版') >= 0,
      text: clip(uiAfter, 600),
    }
    ev.screenshotAfter = await screenshotTo(cdp, outDir, RUN_ID + '-after.png')
    requireTrue(imported, '导入后没有出现「已导入第 2 版」提示；toasts=' + JSON.stringify(seenToasts) + (errorToast ? '；错误=' + errorToast : ''))
    requireTrue(after.latestVersion === 2, '导入后本地版本应为 2，实际 ' + after.latestVersion)
    requireTrue(after.publicationRows === before.publicationRows + 1, 'publications 行数应 +1（' + before.publicationRows + ' → ' + after.publicationRows + '）')
    requireTrue(after.outboxRows === before.outboxRows, '文件导入不应产生回执 outbox（' + before.outboxRows + ' → ' + after.outboxRows + '）')
    requireTrue(ev.uiAfterImport.savedV2, '成员页应显示「本机保存：第 2 版」')

    // ---------- 7) 日志里不能有 DataCloneError ----------
    const log = adbTry(['logcat', '-d', '-v', 'brief', '-t', '4000'], { timeoutMs: 40_000 }).stdout
    const cloneLines = log.split('\n').filter((l) => /DataCloneError|could not be cloned/i.test(l))
    const fatalLines = log.split('\n').filter((l) => /FATAL EXCEPTION|ANR in com\.liubarryteb12/.test(l))
    ev.logScan = { cloneErrorLines: cloneLines.slice(0, 3).map((l) => clip(l, 240)), fatalLines: fatalLines.slice(0, 3).map((l) => clip(l, 240)) }
    requireTrue(cloneLines.length === 0, '日志里出现 DataCloneError（A34 缺陷未修好）：' + clip(cloneLines[0] ?? '', 300))
    requireTrue(fatalLines.length === 0, '日志里出现 FATAL/ANR：' + clip(fatalLines[0] ?? '', 300))

    done = true
    rec.pass('A34', TITLE, {
      ...ev,
      notes: [
        '系统选择器为真实 DocumentsUI（前台 Activity=' + (pickerActivity || '未知') + '），未使用 CDP 拦截或 DOM.setFileInputFiles；',
        '文件通过 adb push 放到 /sdcard/Download（用户可达位置），选择器里点选后由 WebView 读取 content:// 交给应用；',
        '应用链路：pickTextFile → checkPublicImport → 预览（来源文件/版本/校验和/对比）→「导入」→ ingestPublication(queueReceipt:false)；',
        '点选动作由 adb input tap 完成（自动化），不是人手点击；除此之外无任何替代步骤。',
      ],
    })
  } catch (e) {
    rec.fail('A34', TITLE, e instanceof Error ? e.message : String(e), {
      ...ev,
      stack: clip(e instanceof Error ? e.stack : String(e), 2500),
    })
  } finally {
    if (cdp) {
      try {
        cdp.close()
      } catch {
        /* ignore */
      }
    }
    adbTry(['shell', 'input', 'keyevent', '4'], { timeoutMs: 20_000 })
    if (!done && !rec.failed.some((c) => c.id === 'A34')) {
      rec.blocked('A34', TITLE, '无法自动完成（见 A34 失败/证据）', {})
    }
  }
}

if (isMain(import.meta.url)) {
  mkdirSync(OUT_DIR, { recursive: true })
  const rec = new Recorder({ script: 'p7-a34-picker.ts', startedAt: nowIso() })
  await runA34Picker(rec, OUT_DIR)
  console.log(rec.summary())
  console.log('证据文件：' + rec.write(OUT_DIR, 'p7-a34-picker-evidence'))
  process.exit(rec.exitCode)
}
