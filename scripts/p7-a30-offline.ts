/**
 * A30 离线只显示本地版本（不假装知道最新）
 *
 * 断网方式：优先 cmd connectivity airplane-mode enable（回退 svc wifi/data disable），
 * 再用 CDP Network.emulateNetworkConditions offline 双保险；无论成功失败，finally 里一定恢复网络。
 * 判定要点：离线时 UI 只报「本机持有/本机保存第 1 版」，不出现更高版本号、不出现「已是最新」这类断言，
 * 点「领取最新版」必须诚实报错且本地数据不变。
 */
import { Cdp } from './lib/p7-cdp'
import {
  ensureDevice,
  getAirplaneMode,
  setAirplaneMode,
  setWifi,
  setData,
  restoreNetwork,
  deviceInfo,
} from './lib/p7-adb'
import { Recorder, requireTrue, nowIso, clip } from './lib/p7-report'
import {
  openApp,
  readState,
  teamSnapshot,
  resetAndInject,
  gotoTeam,
  screenshotTo,
  sleep,
  sawText,
  isMain,
} from './lib/p7-run'
import { memFixture, MEM_TEAM_ID, YI } from './lib/p7-fixtures'
import { PAGE_LIB, CRYPTO_LIB } from './lib/p7-page'

const TITLE = '离线只显示本地版本，不假装知道最新'

export async function runA30(rec: Recorder, outDir: string): Promise<void> {
  const ev: Record<string, any> = {}
  let cdp: Cdp | null = null
  let networkTouched = false
  let offline = false
  try {
    const serial = ensureDevice()
    ev.device = deviceInfo()
    // 如果 adb 本身走 WiFi（serial 形如 ip:port），关网会断掉 adb，此时只用 CDP 断网
    const adbOverWifi = serial.indexOf(':') >= 0
    ev.adbTransport = adbOverWifi ? 'wifi(' + serial + ')' : 'usb(' + serial + ')'

    cdp = await openApp()
    const mem = memFixture(true)
    ev.inject = await resetAndInject(
      cdp,
      { teams: mem.teams, publications: mem.publications, outbox: mem.outbox, idempotency: [], links: mem.links },
      [MEM_TEAM_ID],
    )
    await gotoTeam(cdp, MEM_TEAM_ID)
    const onlineText = await cdp.text()
    ev.onlineUi = {
      holdsV1: onlineText.indexOf('本机持有第 1 版') >= 0,
      savedV1: onlineText.indexOf('本机保存：第 1 版') >= 0,
      onLine: (await cdp.evalJson<{ onLine: boolean }>('(() => JSON.stringify({ onLine: navigator.onLine }))()')).onLine,
    }
    requireTrue(ev.onlineUi.holdsV1, '在线基线应显示「本机持有第 1 版」')
    requireTrue(ev.onlineUi.savedV1, '在线基线应显示「本机保存：第 1 版」')
    ev.screenshotOnline = await screenshotTo(cdp, outDir, 'p7-a30-online-' + Date.now() + '.png')

    // ---------- 断网 ----------
    const netSteps: string[] = []
    if (!adbOverWifi) {
      networkTouched = true
      const air = setAirplaneMode(true)
      netSteps.push(air.detail)
      if (!air.ok) {
        netSteps.push(setWifi(false).detail)
        netSteps.push(setData(false).detail)
      }
      netSteps.push('airplane_mode_on=' + getAirplaneMode())
    } else {
      netSteps.push('adb 走 WiFi，跳过系统网络开关（避免自断连接），只用 CDP 断网')
    }
    await cdp.setOffline(true)
    netSteps.push('CDP Network.emulateNetworkConditions offline=true')
    ev.networkSteps = netSteps
    await sleep(1200)
    const offProbe = await cdp.evalJson<{ onLine: boolean }>('(() => JSON.stringify({ onLine: navigator.onLine }))()')
    ev.offlineProbe = offProbe
    offline = offProbe.onLine === false
    requireTrue(offline, '断网未生效（navigator.onLine 仍为 true）：' + netSteps.join('；'))

    // ---------- 离线重载页面，读 UI ----------
    await cdp.reload()
    await cdp.waitForApp()
    await gotoTeam(cdp, MEM_TEAM_ID)
    const offText = await cdp.text()
    const higherVersion = offText.match(/第 ([2-9]|[1-9][0-9]+) 版/)
    const fakeLatestClaims = ['已是最新', '最新版本为', '已更新到最新', '已同步最新'].filter((s) => offText.indexOf(s) >= 0)
    ev.offlineUi = {
      holdsV1: offText.indexOf('本机持有第 1 版') >= 0,
      savedV1: offText.indexOf('本机保存：第 1 版') >= 0,
      higherVersionMatch: higherVersion ? higherVersion[0] : null,
      fakeLatestClaims,
      onLine: (await cdp.evalJson<{ onLine: boolean }>('(() => JSON.stringify({ onLine: navigator.onLine }))()')).onLine,
    }
    requireTrue(ev.offlineUi.holdsV1, '离线时应仍显示「本机持有第 1 版」')
    requireTrue(ev.offlineUi.savedV1, '离线时应仍显示「本机保存：第 1 版」')
    requireTrue(!higherVersion, '离线时出现了更高的版本号（假装知道最新）：' + String(higherVersion && higherVersion[0]))
    requireTrue(fakeLatestClaims.length === 0, '离线时出现了「已是最新」类断言：' + fakeLatestClaims.join('、'))
    ev.screenshotOffline = await screenshotTo(cdp, outDir, 'p7-a30-offline-' + Date.now() + '.png')

    // ---------- 离线点「领取最新版」：必须诚实报错、数据不变 ----------
    const before = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
    requireTrue(await cdp.clickText('领取最新版'), '找不到「领取最新版」按钮')
    await sleep(2500)
    const toasts = await cdp.evalJson<string[]>('(() => {' + PAGE_LIB + ' return JSON.stringify(p7toasts()); })()')
    const after = teamSnapshot(await readState(cdp), MEM_TEAM_ID)
    ev.claimOffline = { toasts, before: { latestVersion: before.latestVersion, publicationRows: before.publicationRows }, after: { latestVersion: after.latestVersion, publicationRows: after.publicationRows } }
    requireTrue(toasts.length > 0, '离线点「领取最新版」没有任何提示（静默失败不可接受）')
    requireTrue(
      toasts.some((t) => t.indexOf('请先连接组织者主机') >= 0 || t.indexOf('失败') >= 0 || t.indexOf('连不上') >= 0),
      '离线点「领取最新版」的提示不像错误提示：' + JSON.stringify(toasts),
    )
    requireTrue(
      !toasts.some((t) => t.indexOf('已领取第') >= 0),
      '离线时竟然提示「已领取第 N 版」（伪造成功）',
    )
    requireTrue(after.latestVersion === before.latestVersion, '离线点击后本地版本被改动：' + before.latestVersion + ' → ' + after.latestVersion)
    requireTrue(after.publicationRows === before.publicationRows, '离线点击后 publications 行数被改动')

    // ---------- 附加证据（不参与判定）：离线连一个不可达主机，UI 不应假装连上 ----------
    try {
      const fakeTicketExpr =
        '(async () => {' +
        PAGE_LIB +
        CRYPTO_LIB +
        ' const kp = await p7genKeys();' +
        ' const t = "knapsack-team/1?ip=10.255.255.1&port=9&s=" + p7b64u(crypto.getRandomValues(new Uint8Array(8))) + "&t=" + ' +
        JSON.stringify(MEM_TEAM_ID) +
        ' + "&p=" + kp.pub + "&n=P7unreachable";' +
        ' return JSON.stringify({ ticket: t });' +
        ' })()'
      const fake = await cdp.evalJson<{ ticket: string }>(fakeTicketExpr)
      await cdp.evalJson(
        '(() => {' + PAGE_LIB + ' const el = document.querySelector("textarea.code-input"); if (!el) return JSON.stringify({ ok: false }); p7setNativeValue(el, ' + JSON.stringify(fake.ticket) + '); return JSON.stringify({ ok: true }); })()',
      )
      await sleep(400)
      const clicked = await cdp.clickText('连接')
      await sleep(4000)
      const toasts2 = await cdp.evalJson<string[]>('(() => {' + PAGE_LIB + ' return JSON.stringify(p7toasts()); })()')
      const text2 = await cdp.text()
      ev.unreachableHost = {
        clicked,
        toasts: toasts2,
        claimedConnected: toasts2.some((t) => t.indexOf('已连上组织者主机') >= 0) || text2.indexOf('刷新状态') >= 0,
      }
    } catch (e) {
      ev.unreachableHost = { fatal: clip(e instanceof Error ? e.message : String(e), 300) }
    }

    rec.pass('A30', TITLE, {
      ...ev,
      notes: [
        '断网方式：' + netSteps.join('；'),
        '离线期间页面为本地 https://localhost（应用内资源），因此仍可重载与渲染，属预期；',
        '判定依据：离线 UI 只报第 1 版、无更高版本号、无「已是最新」类断言、点领取最新版诚实报错且本地数据不变。',
      ],
    })
  } catch (e) {
    rec.fail('A30', TITLE, e instanceof Error ? e.message : String(e), {
      ...ev,
      stack: clip(e instanceof Error ? e.stack : String(e), 2000),
    })
  } finally {
    // 无论如何先恢复网络，再恢复 CDP 网络模拟
    const restored: string[] = []
    try {
      if (cdp) {
        await cdp.setOffline(false)
        restored.push('CDP offline=false')
      }
    } catch (e) {
      restored.push('CDP 恢复失败：' + String(e))
    }
    if (networkTouched) {
      restored.push(...restoreNetwork())
      restored.push('airplane_mode_on=' + getAirplaneMode())
    }
    console.log('[A30] 网络恢复：' + restored.join('；'))
    const mine = rec.cases.filter((c) => c.id === 'A30')
    const last = mine[mine.length - 1]
    if (last) (last.evidence as Record<string, unknown>).networkRestore = restored
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
  const rec = new Recorder({ script: 'p7-a30-offline.ts', startedAt: nowIso() })
  await runA30(rec, 'scripts/out')
  console.log(rec.summary())
  console.log('证据文件：' + rec.write('scripts/out', 'p7-a30-evidence'))
  process.exit(rec.exitCode)
}
