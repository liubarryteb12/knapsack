/**
 * A34 文件真实往返（系统「选择文件」环节）
 *
 * 自动可做的部分：
 *  1) Node 侧用真实 serializePublicFile 生成 .team-public 文本，用真实 checkPublicImport 校验 digest/新旧；
 *  2) 用 adb shell run-as 把文件放进应用私有目录（files/），并读回字节比对；
 *  3) 走应用自己的保存路径（fileBridge.saveTextFile → Filesystem.writeFile 到 cache）后 adb 读回比对，并查 Share.canShare；
 *  4) 走应用自己的导入路径：点成员页「导入文件」→ pickTextFile 创建 <input type=file> → CDP 拦截系统选择器
 *     → DOM.setFileInputFiles 指向设备文件 → 应用自己 checkPublicImport + 预览 + 「导入」→ ingestPublication(queueReceipt:false)。
 * 必须人工的部分：在系统选择器里真正点选文件（本脚本用 CDP 拦截代替，未点系统 UI）。
 * 因此 A34 总判定只能是「无法执行（需手测）」，自动部分单独记一条结论。
 */
import { Cdp } from './lib/p7-cdp'
import { ensureDevice, runAsRead, runAsWrite, APP_FILES_DIR, APP_CACHE_DIR } from './lib/p7-adb'
import { Recorder, requireTrue, nowIso, clip } from './lib/p7-report'
import { openApp, readState, teamSnapshot, resetAndInject, gotoTeam, screenshotTo, sleep, isMain } from './lib/p7-run'
import { memFixture, MEM_TEAM_ID, YI } from './lib/p7-fixtures'
import { PAGE_LIB, TOASTS_EXPR, writeFileExpr, SHARE_CAN_EXPR, ENSURE_FILE_INPUT_EXPR, READ_FILE_INPUT_EXPR } from './lib/p7-page'
import { checkPublicImport, parsePublicFile } from '../src/team/teamFile'

const TITLE_AUTO = '文件落盘/读回 + 应用导入路径（不含系统选择器 UI）'
const TITLE = 'Android 保存/分享/选择真实往返（系统选择器需人工点击）'
const DEVICE_IMPORT_PATH = APP_FILES_DIR + '/p7-import-v2.team-public'
const SAVE_NAME = 'p7-save-check.team-public'

function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

export async function runA34(rec: Recorder, outDir: string): Promise<void> {
  const ev: Record<string, any> = {}
  let cdp: Cdp | null = null
  let autoOk = false
  try {
    const serial = ensureDevice()
    ev.adbSerial = serial
    const mem = memFixture(true)
    const fileText = mem.fileV2Text
    const fileName = mem.fileV2Name

    // ---------- 1) Node 侧真实校验 ----------
    const nodeCheck = checkPublicImport(fileText, 1)
    ev.nodeSide = {
      fileName,
      bytes: Buffer.byteLength(fileText, 'utf8'),
      version: nodeCheck.snapshot.version,
      comparison: nodeCheck.comparison,
      digestOk: nodeCheck.digestOk,
      teamIdMatches: nodeCheck.snapshot.teamId === MEM_TEAM_ID,
    }
    requireTrue(nodeCheck.digestOk, 'Node 侧真实 checkPublicImport 校验和不一致')
    requireTrue(nodeCheck.comparison === 'newer', 'Node 侧对比结果应为 newer，实际 ' + nodeCheck.comparison)
    requireTrue(nodeCheck.snapshot.teamId === MEM_TEAM_ID, '文件 teamId 与 fixture 不一致')

    // ---------- 2) 写进应用私有目录并读回 ----------
    const w = runAsWrite(DEVICE_IMPORT_PATH, fileText)
    ev.runAsWrite = { code: w.code, stderr: clip(w.stderr, 300) }
    requireTrue(w.code === 0, 'run-as 写文件失败：' + clip(w.stderr, 300))
    const rb = runAsRead(DEVICE_IMPORT_PATH)
    ev.runAsRead = { code: rb.code, bytes: Buffer.byteLength(rb.stdout, 'utf8'), match: normalize(rb.stdout) === normalize(fileText) }
    requireTrue(rb.code === 0, 'run-as 读文件失败：' + clip(rb.stderr, 300))
    requireTrue(normalize(rb.stdout) === normalize(fileText), 'run-as 读回内容与写入不一致')
    const parsedBack = parsePublicFile(normalize(rb.stdout))
    requireTrue(parsedBack.version === 2, '设备端读回解析出的版本应为 2')

    cdp = await openApp()
    ev.inject = await resetAndInject(
      cdp,
      { teams: mem.teams, publications: mem.publications, outbox: mem.outbox, idempotency: [], links: mem.links },
      [MEM_TEAM_ID],
    )

    // ---------- 3) 应用自己的保存路径（Filesystem + Share.canShare） ----------
    const saved = await cdp.evalJson<Record<string, any>>(writeFileExpr(SAVE_NAME, fileText, 'CACHE'))
    ev.appSave = { uri: saved.uri ?? null, fatal: saved.fatal ?? null }
    requireTrue(!saved.fatal, '应用 Filesystem.writeFile 失败：' + String(saved.fatal))
    const savedRead = runAsRead(APP_CACHE_DIR + '/' + SAVE_NAME)
    ev.appSaveReadBack = {
      code: savedRead.code,
      bytes: Buffer.byteLength(savedRead.stdout, 'utf8'),
      match: normalize(savedRead.stdout) === normalize(fileText),
    }
    requireTrue(savedRead.code === 0, '应用保存的文件 adb 读回失败：' + clip(savedRead.stderr, 300))
    requireTrue(ev.appSaveReadBack.match === true, '应用保存的文件 adb 读回内容不一致')
    const share = await cdp.evalJson<Record<string, any>>(SHARE_CAN_EXPR)
    ev.shareCanShare = share
    requireTrue(share.canShare === true, 'Share.canShare 不为 true：' + JSON.stringify(share))

    // ---------- 4) 应用导入路径 ----------
    await gotoTeam(cdp, MEM_TEAM_ID)
    const before = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
    ev.beforeImport = before
    requireTrue(before.latestVersion === 1, '导入前本地版本应为 1，实际 ' + before.latestVersion)

    // 让系统文件选择器不弹真机 UI，而是由 CDP 接管
    let intercepted = false
    try {
      await cdp.send('Page.enable')
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true })
      intercepted = true
    } catch (e) {
      ev.interceptError = clip(e instanceof Error ? e.message : String(e), 300)
    }
    ev.fileChooserIntercepted = intercepted
    // 清掉可能残留的 input
    await cdp.evalRaw('(() => { document.querySelectorAll("input[type=file]").forEach((e) => e.remove()); return true; })()')

    let appImportPathExercised = false
    if (intercepted) {
      const clicked = await cdp.clickText('导入文件')
      requireTrue(clicked, '找不到「导入文件」按钮')
      await sleep(1200)
      let setOk = false
      for (let i = 0; i < 10 && !setOk; i++) {
        setOk = await cdp.setFileInput('input[type="file"]', [DEVICE_IMPORT_PATH]).catch(() => false)
        if (!setOk) await sleep(400)
      }
      ev.setFileInput = setOk
      if (setOk) {
        const previewOk = await cdp.waitForText('导入公共资料文件', 12_000)
        ev.previewShown = previewOk
        if (previewOk) {
          const previewText = await cdp.text()
          ev.previewUi = {
            fileName: previewText.indexOf(fileName) >= 0,
            version2: previewText.indexOf('第 2 版') >= 0,
            comparisonNewer: previewText.indexOf('比本机版本新，可导入') >= 0,
            digestOk: previewText.indexOf('校验和') >= 0,
          }
          requireTrue(ev.previewUi.version2, '预览应显示「第 2 版」')
          requireTrue(ev.previewUi.comparisonNewer, '预览对比应为「比本机版本新，可导入」')
          ev.screenshotPreview = await screenshotTo(cdp, outDir, 'p7-a34-import-preview-' + Date.now() + '.png')
          // 预览阶段还没导入，本地版本不应变
          const mid = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
          requireTrue(mid.latestVersion === 1, '仅预览时本地版本不应变化')
          // 能力对照：证明该 WebView 里 Proxy 不可结构化克隆、纯对象可以（根因定位证据）
          ev.cloneProbe = await cdp
            .evalJson<Record<string, string>>(
              'JSON.stringify((() => { const r = {}; try { structuredClone(new Proxy({ a: 1 }, {})); r.proxy = "ok" } catch (e) { r.proxy = String(e) } try { structuredClone(' +
                JSON.stringify('{"a":1}') +
                '); r.plain = "ok" } catch (e) { r.plain = String(e) } return r })())',
            )
            .catch(() => null)
          ev.clickImportOk = await cdp.clickText('导入')
          requireTrue(ev.clickImportOk, '找不到预览弹窗里的「导入」按钮')
          // 逐轮抓 toast + 页面文本，区分「脚本没点中/提示太快」与「导入真的失败」
          const seenToasts: string[] = []
          let imported = false
          let errorToast: string | null = null
          for (let i = 0; i < 30 && !imported; i++) {
            const toasts = await cdp.evalJson<string[]>(TOASTS_EXPR).catch(() => [] as string[])
            for (const t of toasts) if (seenToasts.indexOf(t) < 0) seenToasts.push(t)
            const pageText = await cdp.text()
            if (pageText.indexOf('已导入第 2 版') >= 0 || seenToasts.some((t) => t.indexOf('已导入第 2 版') >= 0)) {
              imported = true
              break
            }
            const bad = seenToasts.find((t) => /失败|错误|不一致|拒绝|属于另一个团队|无法/.test(t))
            if (bad) {
              errorToast = bad
              break
            }
            await sleep(300)
          }
          ev.importToasts = seenToasts
          ev.importErrorToast = errorToast
          ev.importToast = imported
          if (!imported) {
            ev.importFailureUi = clip(await cdp.text(), 1200)
            ev.importFailureDb = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
          }
          requireTrue(imported, '没有出现「已导入第 2 版」提示；toasts=' + JSON.stringify(seenToasts) + (errorToast ? '；错误提示=' + errorToast : ''))
          appImportPathExercised = true
        }
      }
    }

    if (!appImportPathExercised) {
      // 回退：自建 input + File.text()（与 pickTextFile 相同的读取 API，但不经过应用导入流程）
      await cdp.evalJson(ENSURE_FILE_INPUT_EXPR)
      const setFallback = await cdp.setFileInput('#p7-file-input', [DEVICE_IMPORT_PATH]).catch(() => false)
      ev.fallbackSetFileInput = setFallback
      if (setFallback) {
        const read = await cdp.evalJson<Record<string, any>>(READ_FILE_INPUT_EXPR)
        ev.fallbackRead = { name: read.name ?? null, size: read.size ?? null, fatal: read.fatal ?? null, match: normalize(String(read.text ?? '')) === normalize(fileText) }
      }
    }

    if (appImportPathExercised) {
      await sleep(1200)
      const after = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
      ev.afterImport = after
      requireTrue(after.latestVersion === 2, '导入后本地版本应为 2，实际 ' + after.latestVersion)
      requireTrue(after.publicationRows === 2, '导入后 publications 行数应为 2，实际 ' + after.publicationRows)
      requireTrue(after.outboxRows === before.outboxRows, '文件导入不应产生回执 outbox（' + before.outboxRows + ' → ' + after.outboxRows + '）')
      const uiText = await cdp.text()
      ev.afterImportUi = { savedV2: uiText.indexOf('本机保存：第 2 版') >= 0 }
      requireTrue(ev.afterImportUi.savedV2, '导入后成员页应显示「本机保存：第 2 版」')
      ev.screenshotAfterImport = await screenshotTo(cdp, outDir, 'p7-a34-after-import-' + Date.now() + '.png')
      autoOk = true
      rec.pass('A34-自动', TITLE_AUTO, {
        ...ev,
        notes: [
          '应用导入路径已走通：点「导入文件」→ pickTextFile 的 input → CDP 注入设备文件 → 应用 checkPublicImport → 预览 → 导入 → ingestPublication(queueReceipt:false)；',
          '唯一被替代的是系统文件选择器 UI（CDP 拦截，未在屏幕上点选），这一点在 A34 总判定里记为「需手测」。',
        ],
      })
    } else {
      const fallbackMatch = (ev.fallbackRead as Record<string, any> | undefined)?.match === true
      rec.blocked('A34-自动', TITLE_AUTO, '应用导入路径未能自动化（CDP 拦截文件选择器失败或 input 注入失败）；仅验证了文件落盘与 File.text() 读回', {
        ...ev,
        fallbackFileTextMatched: fallbackMatch,
      })
    }
  } catch (e) {
    rec.fail('A34-自动', TITLE_AUTO, e instanceof Error ? e.message : String(e), {
      ...ev,
      stack: clip(e instanceof Error ? e.stack : String(e), 2000),
    })
  } finally {
    if (cdp) {
      try {
        cdp.close()
      } catch {
        /* ignore */
      }
    }
    rec.blocked('A34', TITLE, '系统「选择文件」需要人工在设备屏幕上点选真实文件，脚本无法代替；本项不判定通过', {
      autoPart: autoOk ? '通过（见 A34-自动）' : '未通过（见 A34-自动）',
      manualSteps: [
        '在设备上打开团队（成员）→ 领取公共版本 → 点「导入文件」→ 系统选择器里选一个真实 .team-public 文件 → 核对预览（来源文件/版本/校验和/对比）→ 点「导入」；',
        '再点「导出资料文件」→ 系统分享面板 → 存到「文件」→ 用文件管理器确认文件存在并能再次导入。',
      ],
    })
  }
}

if (isMain(import.meta.url)) {
  const rec = new Recorder({ script: 'p7-a34-file.ts', startedAt: nowIso() })
  await runA34(rec, 'scripts/out')
  console.log(rec.summary())
  console.log('证据文件：' + rec.write('scripts/out', 'p7-a34-evidence'))
  process.exit(rec.exitCode)
}
