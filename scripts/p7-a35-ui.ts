/**
 * A35 小屏 / 深浅主题 / 错误不丢草稿 / 危险动作确认
 *
 * 小屏：Emulation.setDeviceMetricsOverride 360x640 dpr3 mobile，断言 innerWidth=360、命中 (max-width:720px)、
 *       侧边栏变横向底部导航、无横向溢出；同时用 CDP 截图与 adb exec-out screencap 各存一张到 scripts/out/。
 * 主题：写 localStorage 'knapsack.theme' = light/dark 后重载，断言 data-theme 与正文/背景对比度 ≥ 4.5，各截图。
 * 错误不丢草稿：成员页打开「上报」弹窗填值 → 点「提交」（未连接组织者，必报错）→ 断言弹窗仍在且值保留。
 * 危险动作确认：组织者「分工设置」点物资「删除」→ 断言出现确认文案、库里 items 未变 → 点「取消」后仍未变。
 */
import { Cdp } from './lib/p7-cdp'
import { ensureDevice, screencapTo } from './lib/p7-adb'
import { Recorder, requireTrue, nowIso, clip } from './lib/p7-report'
import { openApp, readState, teamSnapshot, resetAndInject, gotoTeam, openTab, screenshotTo, deviceAndApp, sleep, isMain } from './lib/p7-run'
import { orgFixture, memFixture, payloadOf, ORG_TEAM_ID, MEM_TEAM_ID } from './lib/p7-fixtures'
import { PAGE_LIB, LAYOUT_PROBE_EXPR, THEME_PROBE_EXPR, setThemeExpr } from './lib/p7-page'

const TITLE = '小屏/深浅主题可用，错误不丢草稿，危险动作需确认'

interface LayoutProbe {
  innerWidth: number
  innerHeight: number
  dpr: number
  narrow: boolean
  sidebarFlexDirection: string | null
  shellFlexDirection: string | null
  scrollWidth: number
  clientWidth: number
}

interface ThemeProbe {
  dataTheme: string | null
  fg: string
  bg: string
  contrast: number
}

export async function runA35(rec: Recorder, outDir: string): Promise<void> {
  const ev: Record<string, any> = {}
  let cdp: Cdp | null = null
  try {
    ensureDevice()
    ev.device = deviceAndApp().device
    cdp = await openApp()
    ev.inject = await resetAndInject(
      cdp,
      {
        teams: [...orgFixture({}).teams, ...memFixture(true).teams],
        publications: memFixture(true).publications,
        outbox: memFixture(true).outbox,
        idempotency: [],
        links: memFixture(true).links,
      },
      [ORG_TEAM_ID, MEM_TEAM_ID],
    )
    await gotoTeam(cdp, ORG_TEAM_ID)

    // ---------- 小屏 ----------
    const natural = await cdp.evalJson<LayoutProbe>(LAYOUT_PROBE_EXPR)
    ev.layoutNatural = natural
    ev.screenshotNatural = await screenshotTo(cdp, outDir, 'p7-a35-natural-' + Date.now() + '.png')

    await cdp.setDeviceMetrics({ width: 360, height: 640, deviceScaleFactor: 3, mobile: true })
    await sleep(1200)
    const small = await cdp.evalJson<LayoutProbe>(LAYOUT_PROBE_EXPR)
    ev.layoutSmall = small
    requireTrue(small.innerWidth === 360, '小屏模拟后 innerWidth 应为 360，实际 ' + small.innerWidth)
    requireTrue(small.narrow === true, '360px 宽应命中 (max-width:720px)')
    requireTrue(small.sidebarFlexDirection === 'row', '窄屏侧边栏应变为横向（flex-direction:row），实际 ' + String(small.sidebarFlexDirection))
    requireTrue(small.scrollWidth <= small.clientWidth + 2, '小屏出现横向溢出：scrollWidth=' + small.scrollWidth + ' clientWidth=' + small.clientWidth)
    ev.screenshotSmallCdp = await screenshotTo(cdp, outDir, 'p7-a35-small-360x640-' + Date.now() + '.png')
    await sleep(400)
    ev.screenshotSmallAdb = screencapTo(outDir + '/p7-a35-small-adb-' + Date.now() + '.png')
    const smallText = await cdp.text()
    requireTrue(smallText.indexOf('瓶装水') >= 0, '小屏下团队内容应仍可见')
    requireTrue(smallText.indexOf('物资与批次分工') >= 0, '小屏下分区标题应仍可见')

    await cdp.setDeviceMetrics(null)
    await sleep(800)
    const restored = await cdp.evalJson<LayoutProbe>(LAYOUT_PROBE_EXPR)
    ev.layoutRestored = restored
    requireTrue(restored.innerWidth === natural.innerWidth, '清除小屏模拟后 innerWidth 未恢复：' + restored.innerWidth + ' vs ' + natural.innerWidth)

    // ---------- 深浅主题 ----------
    const themeResults: Record<string, ThemeProbe> = {}
    for (const mode of ['light', 'dark']) {
      await cdp.evalJson(setThemeExpr(mode))
      await cdp.reload()
      await cdp.waitForApp()
      await gotoTeam(cdp, ORG_TEAM_ID)
      await sleep(700)
      const probe = await cdp.evalJson<ThemeProbe>(THEME_PROBE_EXPR)
      themeResults[mode] = probe
      ev['theme_' + mode] = probe
      ev['screenshot_' + mode] = await screenshotTo(cdp, outDir, 'p7-a35-theme-' + mode + '-' + Date.now() + '.png')
      requireTrue(probe.dataTheme === mode, '切到 ' + mode + ' 后 data-theme 应为 ' + mode + '，实际 ' + String(probe.dataTheme))
      requireTrue(probe.contrast >= 4.5, mode + ' 主题正文对比度不足 4.5：' + probe.contrast + '（fg=' + probe.fg + ' bg=' + probe.bg + '）')
    }
    requireTrue(
      themeResults.light.bg !== themeResults.dark.bg,
      '深浅主题背景色没有变化：' + themeResults.light.bg + ' / ' + themeResults.dark.bg,
    )
    ev.themeContrast = { light: themeResults.light.contrast, dark: themeResults.dark.contrast }
    // 恢复默认跟随系统
    await cdp.evalJson(setThemeExpr('system'))
    await cdp.reload()
    await cdp.waitForApp()

    // ---------- 错误不丢草稿（成员上报弹窗） ----------
    await gotoTeam(cdp, MEM_TEAM_ID)
    requireTrue(await cdp.clickText('上报'), '找不到成员页「上报」按钮')
    requireTrue(await cdp.waitForText('花费（元，可选）', 10_000), '「上报」弹窗没出现')
    const fillExpr =
      '(async () => {' +
      PAGE_LIB +
      ' p7fillByLabel("备注", "P7 未提交草稿备注");' +
      ' p7fillByLabel("花费（元，可选）", "36.00");' +
      ' await p7sleep(200);' +
      ' return JSON.stringify({ note: p7readByLabel("备注"), amount: p7readByLabel("花费（元，可选）") });' +
      ' })()'
    const filled = await cdp.evalJson<Record<string, unknown>>(fillExpr)
    ev.draftFilled = filled
    requireTrue(filled.note === 'P7 未提交草稿备注', '备注没有填进输入框：' + JSON.stringify(filled))
    requireTrue(filled.amount === '36.00', '花费没有填进输入框：' + JSON.stringify(filled))

    requireTrue(await cdp.clickText('提交'), '找不到弹窗「提交」按钮')
    await sleep(1500)
    const toasts = await cdp.evalJson<string[]>('(() => {' + PAGE_LIB + ' return JSON.stringify(p7toasts()); })()')
    ev.draftErrorToasts = toasts
    requireTrue(
      toasts.some((t) => t.indexOf('请先连接组织者主机') >= 0),
      '提交时应提示「请先连接组织者主机」，实际提示：' + JSON.stringify(toasts),
    )
    const keepNote = await cdp.evalJson<Record<string, unknown>>(
      '(() => {' + PAGE_LIB + ' return JSON.stringify({ note: p7readByLabel("备注"), amount: p7readByLabel("花费（元，可选）"), modalVisible: p7text().indexOf("花费（元，可选）") >= 0 }); })()',
    )
    ev.draftAfterError = keepNote
    requireTrue(keepNote.modalVisible === true, '提交报错后「上报」弹窗被关掉了（草稿丢失）')
    requireTrue(keepNote.note === 'P7 未提交草稿备注', '提交报错后备注被清空：' + JSON.stringify(keepNote))
    requireTrue(keepNote.amount === '36.00', '提交报错后花费被清空：' + JSON.stringify(keepNote))
    ev.screenshotDraftKept = await screenshotTo(cdp, outDir, 'p7-a35-draft-kept-' + Date.now() + '.png')
    await cdp.clickText('取消')
    await sleep(500)

    // ---------- 危险动作确认（删除物资） ----------
    await gotoTeam(cdp, ORG_TEAM_ID)
    await openTab(cdp, '分工设置', '物资与批次分工')
    const beforeDel = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    requireTrue(await cdp.clickText('删除'), '找不到物资行的「删除」按钮')
    const popShown = await cdp.waitForText('删除该物资会同时移除它的批次，确定？', 8_000)
    ev.popconfirmShown = popShown
    requireTrue(popShown, '点「删除」没有出现确认文案（危险动作没有二次确认）')
    ev.screenshotPopconfirm = await screenshotTo(cdp, outDir, 'p7-a35-popconfirm-' + Date.now() + '.png')
    const duringDel = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    ev.itemsDuringPopconfirm = duringDel.items
    requireTrue(duringDel.items === beforeDel.items, '仅弹出确认框时 items 就变了：' + beforeDel.items + ' → ' + duringDel.items)
    requireTrue(await cdp.clickText('取消'), '找不到确认框的「取消」按钮')
    await sleep(900)
    const afterCancel = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    ev.itemsAfterCancel = afterCancel.items
    requireTrue(afterCancel.items === beforeDel.items, '点「取消」后 items 仍被删除：' + beforeDel.items + ' → ' + afterCancel.items)

    rec.pass('A35', TITLE, ev)
  } catch (e) {
    rec.fail('A35', TITLE, e instanceof Error ? e.message : String(e), {
      ...ev,
      stack: clip(e instanceof Error ? e.stack : String(e), 2000),
    })
  } finally {
    if (cdp) {
      try {
        await cdp.setDeviceMetrics(null)
      } catch {
        /* ignore */
      }
      try {
        cdp.close()
      } catch {
        /* ignore */
      }
    }
  }
}

if (isMain(import.meta.url)) {
  const rec = new Recorder({ script: 'p7-a35-ui.ts', startedAt: nowIso() })
  await runA35(rec, 'scripts/out')
  console.log(rec.summary())
  console.log('证据文件：' + rec.write('scripts/out', 'p7-a35-evidence'))
  process.exit(rec.exitCode)
}
