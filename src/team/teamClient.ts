/**
 * 团队协议 · 成员端客户端（knapsack-team/1）
 *
 * 流程（SPEC 6.2）：
 * 1. 扫码拿到主机会话票（含主机临时公钥）
 * 2. 本机生成临时 ECDH 密钥对，与主机公钥派生**本成员专属**会话密钥
 * 3. 提交加入申请（加密），轮询审批状态；审批通过后保存 memberId + 凭证
 * 4. 后续请求带凭证（主机从凭证推导作者），落库后主机才回成功
 *
 * 恢复配对：deviceId/joinRequestId 在本机持久保存，重新申请时主机可核对并保留原 memberId。
 */
import {
  generateEcdhKeyPair,
  importEcdhPublicKey,
  deriveSessionKey,
  sealWithAad,
  openWithAad,
  buildAad,
  randomBytes,
  toB64u,
  parseHostTicket,
  base64ToBytes,
  type HostSessionTicket,
  type Bytes,
  type EcdhKeyPair,
} from './identity'
import { makeEnvelope, type TeamEnvelope, type TeamActionName, type TeamResponse } from './teamProtocol'
import { getTeamLink, putTeamLink } from '../db/teamActions'
import type { TeamLink } from '../db/teamSchema'
import type { PublicSnapshot } from './schema'

export interface MemberSession {
  ticket: HostSessionTicket
  keys: EcdhKeyPair
  /** 与主机共享的会话密钥（本成员专属，成员之间互不可解密） */
  sessionKey: CryptoKey
  link: TeamLink
}

/** 建立与主机的加密会话（不发业务请求） */
export async function openMemberSession(
  ticketText: string,
  link: TeamLink,
): Promise<MemberSession> {
  const ticket = parseHostTicket(ticketText)
  if (ticket.teamId !== link.teamId) throw new Error('会话码属于另一个团队')
  const keys = await generateEcdhKeyPair()
  const hostPub = await importEcdhPublicKey(ticket.hostPub)
  const sessionKey = await deriveSessionKey(keys.privateKey, hostPub, ticket.sessionId, 'host<-client')
  return { ticket, keys, sessionKey, link }
}

/** 明文握手：确认对面是团队主机并拿到团队名 */
export async function fetchHostInfo(
  ticketText: string,
  timeoutMs = 8000,
): Promise<{ app: string; protocol: string; sessionId: string; teamId: string; teamName: string }> {
  const t = parseHostTicket(ticketText)
  const resp = await fetch(`http://${t.ip}:${t.port}/info`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!resp.ok) throw new Error(`主机返回 ${resp.status}`)
  const data = (await resp.json()) as {
    app: string
    protocol: string
    sessionId: string
    teamId: string
    teamName: string
  }
  if (data.app !== 'knapsack' || data.protocol !== 'knapsack-team/1') {
    throw new Error('对面不是行囊团队主机')
  }
  return data
}

/** 发送一个已加密动作；失败抛错，不伪造成功 */
export async function sendAction(
  session: MemberSession,
  type: TeamActionName,
  payload: unknown,
  operationId: string,
  timeoutMs = 25000,
): Promise<TeamResponse> {
  const envelope = makeEnvelope(session.ticket.teamId, operationId, type, payload)
  return postEnvelope(session, envelope, timeoutMs)
}

async function postEnvelope(
  session: MemberSession,
  envelope: TeamEnvelope,
  timeoutMs: number,
): Promise<TeamResponse> {
  const { ticket, keys, sessionKey } = session
  // AAD 绑定动作类型与操作号（SPEC 6.3）：接收方解密时会用同一组期望值，
  // 载荷里的类型若与 AAD 不一致则 GCM 认证失败，防跨动作重放。
  const aad = buildAad(ticket.sessionId, 'POST', '/action', {
    type: envelope.type,
    operationId: envelope.operationId,
  })
  const body = await sealWithAad(sessionKey, utf8Bytes(JSON.stringify(envelope)), aad)
  const url = `http://${ticket.ip}:${ticket.port}/action?c=${encodeURIComponent(keys.publicKeyB64u)}`

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`主机返回 ${resp.status}${text ? '：' + text : ''}`)
  }
  // 响应是 base64 文本，解出密文再解密
  const b64 = (await resp.text()).trim()
  const sealed = base64ToBytes(b64)
  const plain = await openWithAad(sessionKey, sealed, aad)
  return JSON.parse(new TextDecoder().decode(plain)) as TeamResponse
}

// ---------- 加入团队 ----------

export interface JoinOptions {
  ticketText: string
  memberName: string
  /** 已存在关联时传入，用于恢复配对（保留原 memberId） */
  existingLink?: TeamLink
}

export type JoinOutcome =
  | { ok: true; link: TeamLink; teamName: string }
  | { ok: false; error: string }

/**
 * 加入团队：提交申请并轮询审批。
 * - 首次加入无需私人 Trip（A21）；
 * - 审批通过后保存 memberId + 凭证；凭证保存成功才算加入完成。
 */
export async function joinTeam(opts: JoinOptions): Promise<JoinOutcome> {
  try {
    const ticket = parseHostTicket(opts.ticketText)
    const keys = await generateEcdhKeyPair()
    const hostPub = await importEcdhPublicKey(ticket.hostPub)
    const sessionKey = await deriveSessionKey(keys.privateKey, hostPub, ticket.sessionId, 'host<-client')

    const joinRequestId = opts.existingLink?.joinRequestId ?? toB64u(randomBytes(10))
    const deviceId = opts.existingLink?.deviceId ?? toB64u(randomBytes(10))

    const session: MemberSession = {
      ticket,
      keys,
      sessionKey,
      link: {
        teamId: ticket.teamId,
        memberId: opts.existingLink?.memberId ?? '',
        memberName: opts.memberName,
        joinRequestId,
        deviceId,
        credential: opts.existingLink?.credential ?? '',
        localTripId: opts.existingLink?.localTripId ?? null,
        joinedAt: opts.existingLink?.joinedAt ?? Date.now(),
      },
    }

    const req = await sendAction(session, 'join.request', {
      joinRequestId,
      deviceId,
      memberName: opts.memberName,
      clientPub: keys.publicKeyB64u,
    }, joinRequestId)
    if (!req.ok) return { ok: false, error: req.error ?? '申请被拒绝' }

    // 轮询审批（组织者在主机上点通过）
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const st = await sendAction(session, 'join.status', { joinRequestId }, `${joinRequestId}-poll`)
      if (!st.ok) return { ok: false, error: st.error ?? '查询状态失败' }
      const r = st.result as { ok?: boolean; status?: string; memberId?: string; credential?: string; deviceId?: string; error?: string }
      if (r?.status === 'rejected') return { ok: false, error: '组织者拒绝了加入申请' }
      if (r?.status === 'approved' && r.memberId && r.credential) {
        const link: TeamLink = {
          teamId: ticket.teamId,
          memberId: r.memberId,
          memberName: opts.memberName,
          joinRequestId,
          deviceId: r.deviceId ?? deviceId,
          credential: r.credential,
          localTripId: opts.existingLink?.localTripId ?? null,
          joinedAt: opts.existingLink?.joinedAt ?? Date.now(),
        }
        // 凭证落库成功才算加入完成；失败要如实报错（A21）
        await putTeamLink(link)
        const saved = await getTeamLink(ticket.teamId)
        if (!saved || saved.credential !== link.credential) {
          return { ok: false, error: '凭证保存失败，请重新加入或由组织者恢复配对' }
        }
        return { ok: true, link, teamName: ticket.teamName }
      }
      await sleep(1500)
    }
    return { ok: false, error: '等待组织者审批超时，请重试或让组织者恢复配对' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 已加入成员的常规请求 ----------

/** 已加入成员连接主机：用既有凭证认证 */
export async function connectAsMember(ticketText: string): Promise<MemberSession> {
  const ticket = parseHostTicket(ticketText)
  const link = await getTeamLink(ticket.teamId)
  if (!link) throw new Error('本机还没有加入这个团队')
  return openMemberSession(ticketText, link)
}

function authOf(session: MemberSession) {
  return {
    memberId: session.link.memberId,
    deviceId: session.link.deviceId,
    credential: session.link.credential,
  }
}

/** 领取最新公共快照（主机侧只返回快照；本机保存与回执由调用方走 ingestPublication） */
export async function fetchLatestPublication(session: MemberSession): Promise<PublicSnapshot | null> {
  const res = await sendAction(session, 'publication.latest', { auth: authOf(session) }, opId('pub'))
  if (!res.ok) throw new Error(res.error ?? '查询最新发布失败')
  const r = res.result as { snapshot?: PublicSnapshot | null }
  return r?.snapshot ?? null
}

/** 提交报告（作者由主机从凭证推导，本机不填 authorMemberId） */
export async function submitReport(
  session: MemberSession,
  draft: Record<string, unknown>,
  operationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await sendAction(session, 'submission.submit', { auth: authOf(session), draft }, operationId)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/** 发送领取回执（本机保存成功后才调用） */
export async function sendReceipt(
  session: MemberSession,
  publicationId: string,
  version: number,
  operationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await sendAction(
    session,
    'receipt.submit',
    { auth: authOf(session), publicationId, version },
    operationId,
  )
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

// ---------- 辅助 ----------

function utf8Bytes(s: string): Bytes {
  return new TextEncoder().encode(s) as Bytes
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let opSeq = 0
function opId(prefix: string): string {
  opSeq++
  return `${prefix}-${Date.now().toString(36)}-${opSeq}`
}
// ---------- 组织者远程操作（手机主机放家里，人在其他设备上汇总） ----------
//
// 组织者用自己的成员凭证接入任意一台主机（不一定是自己的手机），
// 主机侧 dispatchAction 对 organizer.* 动作校验 role=organizer 后
// 代为执行本地事务。所有授权都走既有凭证链路，无新增密码学面。

/** 确认/退回一条报告 */
export async function organizerDecide(
  session: MemberSession,
  submissionId: string,
  revision: number,
  decision: 'confirmed' | 'rejected',
  note?: string,
): Promise<{ ok: boolean; error?: string; replay?: boolean }> {
  const res = await sendAction(
    session,
    'organizer.decision',
    { auth: authOf(session), submissionId, revision, decision, note },
    `remote-confirm-${submissionId}-${revision}`,
  )
  return res.ok ? { ok: true, replay: res.replay } : { ok: false, error: res.error }
}

/** 审批/拒绝加入申请；restoreMemberId 用于恢复配对 */
export async function organizerApprove(
  session: MemberSession,
  joinRequestId: string,
  decision: 'approved' | 'rejected',
  restoreMemberId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await sendAction(
    session,
    'organizer.approve',
    {
      auth: authOf(session),
      joinRequestId,
      decision,
      restoreMemberId,
    },
    `remote-approve-${joinRequestId}`,
  )
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/**
 * 发布不可变快照。
 * expectedPreviewDigest 保证发布内容与预览一致（可选）；
 * releaseNote 是组织者寄语（细节 A），随快照落库、成员端领取后展示。
 */
export async function organizerPublish(
  session: MemberSession,
  expectedDraftRevision: number,
  expectedPreviewDigest?: string,
  releaseNote?: string,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  const trimmed = releaseNote && releaseNote.trim() ? releaseNote.trim().slice(0, 200) : undefined
  const res = await sendAction(
    session,
    'organizer.publish',
    {
      auth: authOf(session),
      expectedDraftRevision,
      expectedPreviewDigest,
      releaseNote: trimmed,
    },
    `remote-publish-${Date.now().toString(36)}`,
  )
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, version: (res.result as { version: number }).version }
}
/** 撤回自己一条待审报告（SPEC 3.4 显式撤回请求） */
export async function withdrawMyReport(
  session: MemberSession,
  submissionId: string,
  revision: number,
): Promise<{ ok: boolean; error?: string; replay?: boolean }> {
  const res = await sendAction(
    session,
    'submission.withdraw',
    { auth: authOf(session), submissionId, revision },
    `withdraw-${submissionId}-`,
  )
  return res.ok ? { ok: true, replay: res.replay } : { ok: false, error: res.error }
}
