/**
 * A28 主机重启保留（版本 / 报告 / 审核 / 回执 / 历史）
 *
 * 造数据的方式尽量真实：只注入「成员上报」这类单机无法自己产生的输入，
 * 之后的确认（decideSubmission）、发布（publishSnapshot）全部用应用 UI 真实点击完成，
 * 然后 adb shell am force-stop + am start 重启应用，再读回逐字段比对。
 */
import { Cdp } from './lib/p7-cdp'
import { ensureDevice } from './lib/p7-adb'
import { Recorder, requireTrue, nowIso, clip } from './lib/p7-report'
import {
  openApp,
  readState,
  teamSnapshot,
  diffSnapshot,
  resetAndInject,
  gotoTeam,
  openTab,
  screenshotTo,
  deviceAndApp,
  sleep,
  isMain,
} from './lib/p7-run'
import { orgFixture, payloadOf, ORG_TEAM_ID } from './lib/p7-fixtures'

const TITLE = '主机重启后版本/报告/审核/回执/历史全部保留'

export async function runA28(rec: Recorder, outDir: string): Promise<void> {
  const ev: Record<string, any> = {}
  let cdp: Cdp | null = null
  try {
    ensureDevice()
    ev.device = deviceAndApp().device

    cdp = await openApp()
    ev.inject = await resetAndInject(cdp, payloadOf(orgFixture()), [ORG_TEAM_ID])
    await gotoTeam(cdp, ORG_TEAM_ID)

    const text0 = await cdp.text()
    ev.uiAfterInject = {
      organizer: text0.indexOf('你是组织者（汇总主机）') >= 0,
      unpublished: text0.indexOf('尚未发布') >= 0,
      itemName: text0.indexOf('瓶装水') >= 0,
    }
    requireTrue(ev.uiAfterInject.organizer, '未进入组织者视图')
    requireTrue(ev.uiAfterInject.unpublished, '前置状态应为「尚未发布」')

    const snapInjected = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    ev.snapshotAfterInject = snapInjected
    requireTrue(snapInjected.submissionReviews.length === 5, '注入上报应为 5 条，实际 ' + snapInjected.submissionReviews.length)
    requireTrue(snapInjected.latestVersion === 0, '注入后不应有已发布版本')

    // ---- 真实动作 1：逐条确认待审核报告（decideSubmission） ----
    await openTab(cdp, '汇总与确认', '待审核报告')
    let confirmRounds = 0
    for (let i = 0; i < 8; i++) {
      const t = await cdp.text()
      if (t.indexOf('暂无待审核报告。') >= 0) break
      const clicked = await cdp.clickText('确认')
      if (!clicked) throw new Error('找不到「确认」按钮（第 ' + (i + 1) + ' 轮）')
      confirmRounds++
      await sleep(800)
    }
    await cdp.waitForText('暂无待审核报告。', 12_000)
    ev.confirmRounds = confirmRounds

    const snapConfirmed = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    ev.snapshotAfterConfirm = snapConfirmed
    const confirmedCount = snapConfirmed.submissionReviews.filter((s: string) => s.slice(-10) === ':confirmed').length
    requireTrue(confirmedCount === 4, '应有 4 条 confirmed，实际 ' + confirmedCount + '（' + JSON.stringify(snapConfirmed.submissionReviews) + '）')
    requireTrue(
      snapConfirmed.submissionReviews.indexOf('p7sub-carryrej01:rejected') >= 0,
      '已退回的那条应保持 rejected',
    )
    requireTrue(
      snapConfirmed.expenses.length === 1 && snapConfirmed.expenses[0] === 'p7exp-0000001=3600',
      '确认费用后应有 1 条 expenses=3600，实际 ' + JSON.stringify(snapConfirmed.expenses),
    )
    const textConfirmed = await cdp.text()
    requireTrue(textConfirmed.indexOf('缺 4') >= 0, '缺口总表应显示「缺 4」')
    requireTrue(textConfirmed.indexOf('出发集合：20') >= 0, '清点确认应显示「出发集合：20」')
    ev.uiAfterConfirm = { gap: '缺 4', count: '出发集合：20' }

    // ---- 真实动作 2：发布第 1 版、第 2 版（publishSnapshot） ----
    await openTab(cdp, '会话与发布', '发布第 1 版')
    ev.promptStub = await cdp.evalJson<Record<string, unknown>>(
      "(() => { window.__p7PromptCalls = []; window.__p7PromptOriginal = window.prompt; window.prompt = (message) => { window.__p7PromptCalls.push(String(message)); return window.__p7PromptCalls.length === 1 ? 'P7 发布说明第 1 版' : 'P7 发布说明第 2 版'; }; return JSON.stringify({ ok: true }); })()",
    )
    const publish1Clicked = await cdp.clickMatch('^发布第 1 版$')
    requireTrue(publish1Clicked, '找不到「发布第 1 版」按钮')
    requireTrue(await cdp.waitForText('已发布第 1 版', 20_000), '发布第 1 版未成功')
    await sleep(1000)
    const publish2Clicked = await cdp.clickMatch('^发布第 2 版$')
    requireTrue(publish2Clicked, '找不到「发布第 2 版」按钮')
    requireTrue(await cdp.waitForText('已发布第 2 版', 20_000), '发布第 2 版未成功')
    await sleep(1200)
    const promptCalls = await cdp.evalJson<{ calls: string[] }>(
      "(() => { const calls = window.__p7PromptCalls || []; window.prompt = window.__p7PromptOriginal; delete window.__p7PromptOriginal; return JSON.stringify({ calls }); })()",
    )
    ev.promptCalls = promptCalls.calls
    requireTrue(
      promptCalls.calls.length === 2 && promptCalls.calls.every((text) => text.indexOf('发布说明') >= 0),
      '两次发布都应先询问发布说明，实际 ' + JSON.stringify(promptCalls.calls),
    )

    const beforeRestart = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    ev.beforeRestart = beforeRestart
    requireTrue(beforeRestart.latestVersion === 2, 'latestVersion 应为 2，实际 ' + beforeRestart.latestVersion)
    requireTrue(beforeRestart.publicationRows === 2, 'publications 行数应为 2，实际 ' + beforeRestart.publicationRows)
    requireTrue(
      JSON.stringify(beforeRestart.historyVersions) === '[1,2]',
      'publicationHistory 应为 [1,2]，实际 ' + JSON.stringify(beforeRestart.historyVersions),
    )

    const textBefore = await cdp.text()
    ev.uiBeforeRestart = {
      meta: textBefore.indexOf('已发布第 2 版') >= 0,
      fee: textBefore.indexOf('36.00 元') >= 0,
      receiptBing: textBefore.indexOf('已领取第 2 版') >= 0,
      receiptYi: textBefore.indexOf('领取到第 1 版，待更新') >= 0,
    }
    requireTrue(ev.uiBeforeRestart.meta, 'meta 行应显示「已发布第 2 版」')
    requireTrue(ev.uiBeforeRestart.fee, '预览应显示已确认费用 36.00 元')
    requireTrue(ev.uiBeforeRestart.receiptBing, '分发状态应显示「已领取第 2 版」（丙）')
    requireTrue(ev.uiBeforeRestart.receiptYi, '分发状态应显示「领取到第 1 版，待更新」（乙）')
    ev.screenshotBeforeRestart = await screenshotTo(cdp, outDir, 'p7-a28-before-restart-' + Date.now() + '.png')

    // ---- 杀进程重启 ----
    rec.log('[A28] adb shell am force-stop ' + 'com.liubarryteb12.knapsack' + ' + am start，重启应用…')
    cdp.close()
    cdp = await openApp()
    await gotoTeam(cdp, ORG_TEAM_ID)

    const afterRestart = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    ev.afterRestart = afterRestart
    const diffs = diffSnapshot(beforeRestart, afterRestart)
    ev.restartDiff = diffs
    requireTrue(diffs.length === 0, '重启前后数据不一致：' + diffs.join('；'))

    const textAfter = await cdp.text()
    ev.uiAfterRestartSetup = {
      organizer: textAfter.indexOf('你是组织者（汇总主机）') >= 0,
      meta: textAfter.indexOf('已发布第 2 版') >= 0,
      itemName: textAfter.indexOf('瓶装水') >= 0,
    }
    requireTrue(ev.uiAfterRestartSetup.meta, '重启后 meta 行应仍显示「已发布第 2 版」')

    await openTab(cdp, '汇总与确认', '待审核报告')
    const textSummary = await cdp.text()
    ev.uiAfterRestartSummary = {
      pendingEmpty: textSummary.indexOf('暂无待审核报告。') >= 0,
      gap: textSummary.indexOf('缺 4') >= 0,
      count: textSummary.indexOf('出发集合：20') >= 0,
    }
    requireTrue(ev.uiAfterRestartSummary.pendingEmpty, '重启后待审核应为空')
    requireTrue(ev.uiAfterRestartSummary.gap, '重启后缺口应仍为「缺 4」')
    requireTrue(ev.uiAfterRestartSummary.count, '重启后清点确认应仍为「出发集合：20」')

    await openTab(cdp, '会话与发布', '已发布第 2 版')
    // 分发状态由 loadReceipts() 异步读库后渲染，必须等它出现再断言（否则是脚本竞态，不是应用缺陷）
    const receiptsRendered = await cdp.waitForText('已领取第 2 版', 10_000)
    const textPublish = await cdp.text()
    const diAfter = textPublish.indexOf('分发状态')
    ev.uiAfterRestartPublish = {
      receiptsRendered,
      fee: textPublish.indexOf('36.00 元') >= 0,
      receiptBing: textPublish.indexOf('已领取第 2 版') >= 0,
      receiptYi: textPublish.indexOf('领取到第 1 版，待更新') >= 0,
      distributionText: diAfter >= 0 ? clip(textPublish.slice(diAfter, diAfter + 400), 400) : '(未找到「分发状态」区块)',
    }
    requireTrue(ev.uiAfterRestartPublish.fee, '重启后预览应仍显示 36.00 元')
    requireTrue(ev.uiAfterRestartPublish.receiptBing, '重启后丙的领取状态应仍为「已领取第 2 版」')
    requireTrue(ev.uiAfterRestartPublish.receiptYi, '重启后乙的领取状态应仍为「领取到第 1 版，待更新」')
    ev.screenshotAfterRestart = await screenshotTo(cdp, outDir, 'p7-a28-after-restart-' + Date.now() + '.png')

    rec.pass('A28', TITLE, ev)
  } catch (e) {
    rec.fail('A28', TITLE, e instanceof Error ? e.message : String(e), { ...ev, stack: clip(e instanceof Error ? e.stack : String(e), 2000) })
  } finally {
    if (cdp) {
      try {
        cdp.close()
      } catch {
        /* ignore */
      }
    }
  }
}

if (isMain(import.meta.url)) {
  const rec = new Recorder({ script: 'p7-a28-restart.ts', startedAt: nowIso() })
  await runA28(rec, 'scripts/out')
  console.log(rec.summary())
  console.log('证据文件：' + rec.write('scripts/out', 'p7-a28-evidence'))
  process.exit(rec.exitCode)
}
