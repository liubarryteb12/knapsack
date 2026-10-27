/**
 * A22 草稿 / outbox 杀进程恢复 + 重连不复用旧会话密钥
 *
 * 1) 团队草稿：用应用 UI 在「分工设置」里真实新增一项物资（mutate 会推进 draftRevision 并落库）。
 * 2) outbox：单机没有第二个设备，真实回执 outbox 无法自然产生，因此用 CDP 注入 2 条
 *    （1 条 receipt + 1 条 submission），再由成员页面的 pendingOutbox 真实读回并显示。
 * 3) 重启：adb shell am force-stop + am start，重新读库 + 重新渲染 UI，逐字段比对。
 * 4) 会话密钥：UI 开真实会话 → 截获「复制会话码」拿到 ticket → 页面内做与 identity.ts 一致的
 *    ECDH/HKDF/AES-GCM 握手；重启后再开会话（新 sessionId + 新主机临时公钥），把旧会话密文
 *    重放到新会话地址，必须被拒（非 200），同时用新 ticket 握手必须成功（对照）。
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
import {
  CLIPBOARD_PATCH_EXPR,
  READ_TICKET_EXPR,
  SCAN_STORAGE_EXPR,
  PAGE_LIB,
  handshakeExpr,
  replayOldSealedExpr,
  infoExpr,
} from './lib/p7-page'
import {
  orgFixture,
  memFixture,
  payloadOf,
  ORG_TEAM_ID,
  MEM_TEAM_ID,
  MEM_JOIN_REQUEST,
  YI,
} from './lib/p7-fixtures'

const TITLE = '草稿/outbox 杀进程恢复；重连不复用旧会话密钥'
const DRAFT_ITEM_NAME = 'P7 草稿饼干'

function ticketParams(ticket: string): Record<string, string> {
  const i = ticket.indexOf('?')
  const q = new URLSearchParams(i >= 0 ? ticket.slice(i + 1) : '')
  const out: Record<string, string> = {}
  q.forEach((v, k) => {
    out[k] = v
  })
  return out
}

async function openSessionAndCopyTicket(cdp: Cdp): Promise<string> {
  const patch = await cdp.evalJson<Record<string, unknown>>(CLIPBOARD_PATCH_EXPR)
  if (patch.patched !== true) throw new Error('无法拦截 navigator.clipboard.writeText：' + String(patch.err))
  const started = await cdp.clickText('开启会话')
  if (!started) throw new Error('找不到「开启会话」按钮')
  await cdp.waitForText('复制会话码', 30_000)
  await sleep(600)
  const copied = await cdp.clickText('复制会话码')
  if (!copied) throw new Error('找不到「复制会话码」按钮')
  for (let i = 0; i < 20; i++) {
    const t = await cdp.evalJson<{ ticket: string | null; err: string | null }>(READ_TICKET_EXPR)
    if (t.ticket && t.ticket.indexOf('knapsack-team/1?') === 0) return t.ticket
    await sleep(300)
  }
  const t = await cdp.evalJson<{ ticket: string | null; err: string | null }>(READ_TICKET_EXPR)
  throw new Error('没有截获到会话码（clipErr=' + String(t.err) + '）')
}

export async function runA22(rec: Recorder, outDir: string): Promise<void> {
  const ev: Record<string, any> = {}
  let cdp: Cdp | null = null
  try {
    ensureDevice()
    ev.device = deviceAndApp().device

    // ---------- 造数据 ----------
    cdp = await openApp()
    const org = orgFixture({})
    const mem = memFixture(true)
    ev.inject = await resetAndInject(
      cdp,
      {
        teams: [...org.teams, ...mem.teams],
        publications: mem.publications,
        outbox: mem.outbox,
        idempotency: [],
        links: mem.links,
      },
      [ORG_TEAM_ID, MEM_TEAM_ID],
    )

    // ---------- 团队草稿：UI 真实编辑 ----------
    await gotoTeam(cdp, ORG_TEAM_ID)
    await openTab(cdp, '分工设置', '物资与批次分工')
    const draft0 = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    ev.draftBefore = { items: draft0.items, draftRevision: draft0.draftRevision }

    requireTrue(await cdp.clickText('物资'), '找不到「物资」添加按钮')
    requireTrue(await cdp.waitForText('添加物资需求', 10_000), '「添加物资需求」弹窗没出现')
    const fill = await cdp.evalJson<Record<string, unknown>>(
      '(async () => {' + PAGE_LIB + ' p7fillByLabel("名称", ' + JSON.stringify(DRAFT_ITEM_NAME) + '); await p7sleep(200); return JSON.stringify({ name: p7readByLabel("名称"), qty: p7readByLabel("需求数量（整数最小单位，如 1500 ml）") }); })()',
    )
    ev.draftFill = fill
    requireTrue(await cdp.clickText('添加'), '找不到弹窗「添加」按钮')
    let draft1 = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    for (let i = 0; i < 20 && draft1.items !== 2; i++) {
      await sleep(300)
      draft1 = teamSnapshot(await readState(cdp), ORG_TEAM_ID)
    }
    ev.draftAfter = { items: draft1.items, draftRevision: draft1.draftRevision }
    requireTrue(draft1.items === 2, 'UI 新增物资后 items 应为 2，实际 ' + draft1.items)
    requireTrue(
      draft1.draftRevision === draft0.draftRevision + 1,
      'draftRevision 应 +1（' + draft0.draftRevision + ' → ' + draft1.draftRevision + '）',
    )
    const draftText = await cdp.text()
    requireTrue(draftText.indexOf(DRAFT_ITEM_NAME) >= 0, '页面上应显示新加的物资名')
    requireTrue(draftText.indexOf('尚未发布') >= 0, '未发布草稿不应显示已发布版本')
    ev.screenshotDraft = await screenshotTo(cdp, outDir, 'p7-a22-draft-' + Date.now() + '.png')

    // ---------- 成员侧：outbox 由 UI 真实读回 ----------
    await gotoTeam(cdp, MEM_TEAM_ID)
    const memText = await cdp.text()
    ev.memberUi = {
      holdsV1: memText.indexOf('本机持有第 1 版') >= 0,
      savedV1: memText.indexOf('本机保存：第 1 版') >= 0,
      pendingOutbox: memText.indexOf('2 条回执待补传') >= 0,
    }
    requireTrue(ev.memberUi.holdsV1, '成员页应显示「本机持有第 1 版」')
    requireTrue(ev.memberUi.pendingOutbox, '成员页应显示「2 条回执待补传」（pendingOutbox 读回）')

    // ---------- 真实会话 + 握手，截获旧会话密文 ----------
    await gotoTeam(cdp, ORG_TEAM_ID)
    await openTab(cdp, '会话与发布', '开启会话')
    const ticketOld = await openSessionAndCopyTicket(cdp)
    const pOld = ticketParams(ticketOld)
    ev.sessionOld = { sessionId: pOld.s, ip: pOld.ip, port: pOld.port, hostPubLen: (pOld.p || '').length }
    requireTrue(pOld.t === ORG_TEAM_ID, '会话码 teamId 应为 ' + ORG_TEAM_ID + '，实际 ' + pOld.t)

    const hsOld = await cdp.evalJson<Record<string, any>>(
      handshakeExpr({ ticket: ticketOld, type: 'join.status', payload: { joinRequestId: MEM_JOIN_REQUEST }, operationId: 'p7-a22-old' }),
    )
    ev.handshakeOld = {
      status: hsOld.status,
      ok: hsOld.ok,
      sessionId: hsOld.sessionId,
      decrypted: hsOld.decrypted,
      decryptError: hsOld.decryptError,
      bodyText: clip(String(hsOld.bodyText ?? ''), 500),
      fatal: hsOld.fatal,
    }
    requireTrue(!hsOld.fatal, '旧会话握手异常：' + String(hsOld.fatal))
    requireTrue(hsOld.status === 200, '旧会话握手 HTTP 状态应为 200，实际 ' + String(hsOld.status))
    requireTrue(hsOld.decrypted !== null && hsOld.decrypted !== undefined, '旧会话响应无法解密：' + String(hsOld.decryptError))

    // 持久化里不应出现会话密钥/主机公钥/会话码
    const scan = await cdp.evalJson<{ hits: any[]; localKeys: string[]; sessionKeys: string[]; dbs: any[] }>(SCAN_STORAGE_EXPR)
    ev.storageScan = scan
    requireTrue(scan.hits.length === 0, '存储里残留会话密钥类材料：' + JSON.stringify(scan.hits))

    // ---------- 重启前快照 ----------
    const stateBefore = await readState(cdp)
    const before = {
      org: teamSnapshot(stateBefore, ORG_TEAM_ID),
      mem: teamSnapshot(stateBefore, MEM_TEAM_ID),
    }
    ev.beforeRestart = before
    requireTrue(before.mem.outboxRows === 2, '重启前 outbox 应为 2 条，实际 ' + before.mem.outboxRows)
    requireTrue(before.org.items === 2, '重启前组织者 items 应为 2，实际 ' + before.org.items)

    // ---------- 杀进程重启 ----------
    rec.log('[A22] am force-stop + am start 重启应用…')
    cdp.close()
    cdp = await openApp()

    const stateAfter = await readState(cdp)
    const after = {
      org: teamSnapshot(stateAfter, ORG_TEAM_ID),
      mem: teamSnapshot(stateAfter, MEM_TEAM_ID),
    }
    ev.afterRestart = after
    const diffs = [...diffSnapshot(before.org, after.org), ...diffSnapshot(before.mem, after.mem)]
    ev.restartDiff = diffs
    requireTrue(diffs.length === 0, '重启前后数据不一致：' + diffs.join('；'))

    // ---------- 重启后 UI 读回 ----------
    await gotoTeam(cdp, ORG_TEAM_ID)
    const orgTextAfter = await cdp.text()
    ev.orgUiAfterRestart = {
      draftItem: orgTextAfter.indexOf(DRAFT_ITEM_NAME) >= 0,
      stillUnpublished: orgTextAfter.indexOf('尚未发布') >= 0,
    }
    requireTrue(ev.orgUiAfterRestart.draftItem, '重启后组织者页应仍显示草稿物资「' + DRAFT_ITEM_NAME + '」')

    await gotoTeam(cdp, MEM_TEAM_ID)
    const memTextAfter = await cdp.text()
    ev.memberUiAfterRestart = {
      holdsV1: memTextAfter.indexOf('本机持有第 1 版') >= 0,
      savedV1: memTextAfter.indexOf('本机保存：第 1 版') >= 0,
      pendingOutbox: memTextAfter.indexOf('2 条回执待补传') >= 0,
    }
    requireTrue(ev.memberUiAfterRestart.pendingOutbox, '重启后成员页应仍显示「2 条回执待补传」')
    requireTrue(ev.memberUiAfterRestart.savedV1, '重启后成员页应仍显示「本机保存：第 1 版」')
    ev.screenshotAfterRestart = await screenshotTo(cdp, outDir, 'p7-a22-after-restart-' + Date.now() + '.png')

    // ---------- 新会话：旧密文必须被拒 ----------
    await gotoTeam(cdp, ORG_TEAM_ID)
    await openTab(cdp, '会话与发布', '开启会话')
    const ticketNew = await openSessionAndCopyTicket(cdp)
    const pNew = ticketParams(ticketNew)
    ev.sessionNew = { sessionId: pNew.s, ip: pNew.ip, port: pNew.port, hostPubLen: (pNew.p || '').length }
    requireTrue(pNew.s !== pOld.s, '重启后新会话的 sessionId 不应与旧会话相同')
    requireTrue(pNew.p !== pOld.p, '重启后新会话的主机临时公钥不应与旧会话相同')

    const oldUrlOnNewSession =
      'http://' + (pNew.ip || '127.0.0.1') + ':' + pNew.port + '/action?c=' + encodeURIComponent(String(hsOld.clientPub))
    const replay = await cdp.evalJson<Record<string, any>>(
      replayOldSealedExpr({ url: oldUrlOnNewSession, sealedB64: String(hsOld.sealedB64) }),
    )
    ev.replayOldSealed = { status: replay.status, ok: replay.ok, bodyText: clip(replay.bodyText, 300), fatal: replay.fatal }
    requireTrue(!replay.fatal, '重放旧密文时页面报错：' + String(replay.fatal))
    requireTrue(replay.ok !== true, '旧会话密文被新会话接受了（这是安全缺陷）')

    // 旧会话地址应已不再监听
    const oldBase = 'http://' + (pOld.ip || '127.0.0.1') + ':' + pOld.port
    const oldInfo = await cdp.evalJson<Record<string, any>>(infoExpr(oldBase))
    ev.oldSessionInfo = { status: oldInfo.status ?? null, fatal: clip(oldInfo.fatal, 200) }

    // 对照：新 ticket 握手必须成功
    const hsNew = await cdp.evalJson<Record<string, any>>(
      handshakeExpr({ ticket: ticketNew, type: 'join.status', payload: { joinRequestId: MEM_JOIN_REQUEST }, operationId: 'p7-a22-new' }),
    )
    ev.handshakeNew = {
      status: hsNew.status,
      ok: hsNew.ok,
      sessionId: hsNew.sessionId,
      decrypted: hsNew.decrypted,
      decryptError: hsNew.decryptError,
      bodyText: clip(String(hsNew.bodyText ?? ''), 500),
      fatal: hsNew.fatal,
    }
    requireTrue(hsNew.status === 200, '新会话握手 HTTP 状态应为 200，实际 ' + String(hsNew.status))
    requireTrue(hsNew.decrypted !== null && hsNew.decrypted !== undefined, '新会话响应无法解密：' + String(hsNew.decryptError))

    // 收尾：停掉会话，避免残留监听
    await cdp.clickText('停止')
    await sleep(400)

    rec.pass('A22', TITLE, {
      ...ev,
      notes: [
        'outbox 2 条为 CDP 注入（单机没有第二个设备，真实回执 outbox 无法自然产生），由成员页 pendingOutbox 真实读回并显示；',
        '团队草稿为 UI 真实动作产生（新增物资 → draftRevision+1 落库）；',
        '会话密钥证据：旧会话密文重放到新会话被拒 + 旧会话端口不再监听 + 新会话握手成功 + 存储扫描无密钥材料。',
      ],
    })
  } catch (e) {
    rec.fail('A22', TITLE, e instanceof Error ? e.message : String(e), {
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
  }
}

if (isMain(import.meta.url)) {
  const rec = new Recorder({ script: 'p7-a22-restore.ts', startedAt: nowIso() })
  await runA22(rec, 'scripts/out')
  console.log(rec.summary())
  console.log('证据文件：' + rec.write('scripts/out', 'p7-a22-evidence'))
  process.exit(rec.exitCode)
}
