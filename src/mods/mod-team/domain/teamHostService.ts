/**
 * 团队会话主机（Android 前台）· 传输与授权
 *
 * 链路：原生收到 HTTP → 发 teamRequest 事件 → 本模块用 ECDH 派生会话密钥解密、
 * 校验 AAD、做服务端授权、落库事务 → 事务成功才 completeRequest(ok=true) → 原生写响应。
 * 任何失败都 completeRequest(ok=false)，绝不把失败当成功 ACK（A14/A17）。
 *
 * 会话密钥：主机每次启动生成临时 P-256 密钥对，公钥进二维码；
 * 成员用自己的临时私钥 + 主机公钥 ECDH 派生**各自独立**的会话密钥（R04：
 * 共享密钥 ≠ 成员身份，且成员之间互不可解密）。
 * 成员身份另由逐成员凭证（HMAC）证明，见 identity.ts。
 */
import { TeamHost, hasNativeTeamHost, type TeamRequestEvent, type PluginListenerHandleLike } from './teamHostNative'
import {
  generateEcdhKeyPair,
  importEcdhPublicKey,
  deriveSessionKey,
  sealWithAad,
  openWithAad,
  buildAad,
  buildHostTicket,
  randomBytes,
  toB64u,
  base64ToBytes,
  bytesToBase64,
  type Bytes,
} from './identity'
import { okResponse, errResponse, type TeamEnvelope, type TeamResponse } from './teamProtocol'
import {
  acceptSubmission,
  acceptReceipt,
  latestPublicationOf,
  registerJoinRequest,
  getJoinStatus,
  resolveActor,
  decideSubmission,
  approveJoin,
  rejectJoin,
  publishSnapshot,
  withdrawSubmission,
} from '../db/actions'
import type { TeamState, PublicSnapshot } from './schema'

export interface RunningTeamSession {
  sessionId: string
  teamId: string
  port: number
  ips: string[]
  /** 扫码用会话码（含主机临时公钥，不含任何长期秘密） */
  ticket: string
  stop: () => Promise<void>
}

let activeSession: RunningTeamSession | null = null
let listenerHandle: PluginListenerHandleLike | null = null

export function currentTeamSession(): RunningTeamSession | null {
  return activeSession
}

/** 启动主机。会话密钥走 ECDH，二维码只含主机临时公钥 */
export async function startTeamHost(team: TeamState, preferredIp?: string): Promise<RunningTeamSession> {
  if (!hasNativeTeamHost()) {
    throw new Error('当前环境不能当团队主机（仅 Android 应用内可用）')
  }
  if (activeSession) throw new Error('已有进行中的团队会话，先停止再开')

  const sessionId = toB64u(randomBytes(8))
  const hostKeys = await generateEcdhKeyPair()

  // 先挂监听再开监听端口：start 返回时 socket 已经在 accept，
  // 若那一刻还没有监听者，原生 notifyListeners 会直接丢弃事件（Capacitor 不缓存），
  // 成员侧只能干等 20s 超时——表现为「连不上」，用户就会反复重试。
  listenerHandle = await TeamHost.addListener('teamRequest', (evt) => {
    void handleTeamRequest(evt, hostKeys.privateKey, team.teamId, team.name)
  })

  let started: Awaited<ReturnType<typeof TeamHost.start>>
  try {
    started = await TeamHost.start({ sessionId, port: 0 })
  } catch (err) {
    // 启动失败必须收回监听，否则下次启动会挂两个 handler，同一个请求被处理两次
    await listenerHandle.remove().catch(() => {})
    listenerHandle = null
    throw err
  }

  const { ips } = await TeamHost.lanIps()
  const ip = preferredIp && ips.includes(preferredIp) ? preferredIp : (ips[0] ?? '127.0.0.1')

  const ticket = buildHostTicket({
    ip,
    port: started.port,
    sessionId,
    teamId: team.teamId,
    hostPub: hostKeys.publicKeyB64u,
    teamName: team.name,
  })

  activeSession = {
    sessionId,
    teamId: team.teamId,
    port: started.port,
    ips,
    ticket,
    stop: async () => {
      if (listenerHandle) {
        await listenerHandle.remove().catch(() => {})
        listenerHandle = null
      }
      await TeamHost.stop().catch(() => {})
      activeSession = null
    },
  }
  return activeSession
}

export async function stopTeamHost(): Promise<void> {
  if (activeSession) await activeSession.stop()
}

// ---------- 请求处理 ----------

async function handleTeamRequest(
  evt: TeamRequestEvent,
  hostPrivateKey: CryptoKey,
  expectedTeamId: string,
  teamName: string,
): Promise<void> {
  const complete = (ok: boolean, body: string) =>
    TeamHost.completeRequest({ requestId: evt.requestId, ok, body }).catch(() => {})

  try {
    if (evt.route === '/info') {
      // 明文握手：只含协议/会话/团队名，不含业务数据与任何秘密
      await complete(
        true,
        JSON.stringify({
          app: 'knapsack',
          protocol: 'knapsack-team/1',
          sessionId: evt.sessionId,
          teamId: expectedTeamId,
          teamName,
        }),
      )
      return
    }

    if (evt.route !== '/action') {
      await complete(false, 'not found')
      return
    }

    // 成员临时公钥经 query 传递（公钥非秘密；私钥永不出本机）
    const q = new URLSearchParams(evt.path.split('?')[1] ?? '')
    const clientPubB64 = q.get('c') ?? ''
    if (!clientPubB64) throw new Error('缺少客户端公钥')

    const clientPub = await importEcdhPublicKey(clientPubB64)
    const key = await deriveSessionKey(hostPrivateKey, clientPub, evt.sessionId, 'host<-client')

    const raw = base64ToBytes(evt.bodyB64)

    // 先用不含 type/operationId 的 AAD 解密（解密前还不知道这两个字段），
    // 解出后校验载荷类型/操作号存在，再用完整 AAD（绑定 type+operationId）
    // 加密响应——响应的 AAD 与请求侧对称，篡改载荷类型会破坏 GCM 认证。
    const aadBase = buildAad(evt.sessionId, 'POST', '/action')
    const plain = await openWithAad(key, raw, aadBase)
    const envelope = JSON.parse(new TextDecoder().decode(plain)) as TeamEnvelope

    if (envelope.protocol !== 'knapsack-team/1' || envelope.schemaVersion !== 1) {
      throw new Error('协议版本不匹配')
    }
    if (envelope.teamId !== expectedTeamId) throw new Error('团队不匹配')
    if (!envelope.type || !envelope.operationId) throw new Error('报文缺少动作类型或操作号')

    const aad = buildAad(evt.sessionId, 'POST', '/action', {
      type: envelope.type,
      operationId: envelope.operationId,
    })

    const resp = await dispatchAction(envelope, clientPubB64)
    const sealed = await sealWithAad(key, utf8Bytes(JSON.stringify(resp)), aad)
    // 响应以 base64 文本回传，避免二进制经 Java String 转 UTF-8 损坏
    await complete(true, bytesToBase64(sealed))
  } catch (e) {
    await complete(false, e instanceof Error ? e.message : String(e))
  }
}

// ---------- 动作分发（含服务端授权） ----------

async function dispatchAction(envelope: TeamEnvelope, sessionClientPub?: string): Promise<TeamResponse> {
  const p = (envelope.payload ?? {}) as Record<string, unknown>
  const teamId = envelope.teamId

  // 无需身份的动作：加入申请与状态轮询
  switch (envelope.type) {
    case 'join.request': {
      const res = await registerJoinRequest({
        teamId,
        joinRequestId: String(p.joinRequestId ?? ''),
        deviceId: String(p.deviceId ?? ''),
        memberName: String(p.memberName ?? ''),
        clientPub: String(p.clientPub ?? ''),
      })
      return res.ok ? okResponse(res) : errResponse(res.error)
    }
    case 'join.status': {
      // 凭证只交付给发起申请的那个会话：比对请求会话的临时公钥
      const res = await getJoinStatus(teamId, String(p.joinRequestId ?? ''), sessionClientPub)
      return res.ok ? okResponse(res) : errResponse(res.error)
    }
    default:
      break
  }

  // 其余动作必须证明身份：从凭证推导作者，不采信自报身份（A15）
  const claim = p.auth as { memberId?: string; deviceId?: string; credential?: string } | undefined
  if (!claim?.memberId || !claim?.deviceId || !claim?.credential) {
    return errResponse('缺少身份凭证')
  }
  const actor = await resolveActor(teamId, {
    memberId: claim.memberId,
    deviceId: claim.deviceId,
    credential: claim.credential,
  })
  if (!actor) return errResponse('身份凭证无效')

  /**
   * 把动作结果包成协议响应。
   *
   * replay 标记：动作层返回的结果若带 replayed 字段（各 action 的幂等重放
   * 路径写入），转成协议层的 replay，客户端据此区分「新建成功」与
   * 「幂等命中（重试/重传）」。
   */
  const toResponse = (res: Record<string, unknown>): TeamResponse => {
    const r = okResponse(res)
    if (res.replayed === true) r.replay = true
    return r
  }

      // ---- 组织者专用动作：role 由凭证推导，成员冒充直接被拒 ----
  if (envelope.type.startsWith('organizer.')) {
    if (actor.role !== 'organizer') {
      return errResponse('只有组织者能执行这个操作')
    }
    switch (envelope.type) {
      case 'organizer.decision': {
        const res = await decideSubmission({
          teamId,
          organizerMemberId: actor.memberId,
          operationId: envelope.operationId,
          submissionId: String(p.submissionId ?? ''),
          revision: Number(p.revision ?? 0),
          decision: p.decision === 'rejected' ? 'rejected' : 'confirmed',
          note: typeof p.note === 'string' ? p.note : undefined,
        })
        return res.ok ? toResponse(res) : errResponse(res.error)
      }
      case 'organizer.approve': {
        if (p.decision === 'rejected') {
          const rej = await rejectJoin(
            teamId,
            actor.memberId,
            String(p.joinRequestId ?? ''),
          )
          return rej.ok ? toResponse(rej) : errResponse(rej.error)
        }
        const res = await approveJoin({
          teamId,
          organizerMemberId: actor.memberId,
          joinRequestId: String(p.joinRequestId ?? ''),
          restoreMemberId:
            typeof p.restoreMemberId === "string" && p.restoreMemberId
              ? p.restoreMemberId
              : undefined,
        })
        return res.ok ? toResponse(res) : errResponse(res.error)
      }
      case 'organizer.publish': {
        const res = await publishSnapshot({
          teamId,
          organizerMemberId: actor.memberId,
          operationId: envelope.operationId,
          expectedDraftRevision: Number(p.expectedDraftRevision ?? 0),
          expectedPreviewDigest:
            typeof p.expectedPreviewDigest === 'string' ? p.expectedPreviewDigest : undefined,
          itinerary: p.itinerary as PublicSnapshot['itinerary'] | undefined,
          releaseNote: typeof p.releaseNote === 'string' ? p.releaseNote : undefined,
        })
        return res.ok ? toResponse(res) : errResponse(res.error)
      }
      default:
        return errResponse('未知组织者动作')
    }
  }

  switch (envelope.type) {

  case 'publication.latest': {
      const snap = await latestPublicationOf(teamId)
      return okResponse({ snapshot: snap ?? null })
    }
    case 'submission.submit': {
      // 作者由凭证推导；请求体里的 authorMemberId 一律忽略
      const res = await acceptSubmission({
        teamId,
        authorMemberId: actor.memberId,
        operationId: envelope.operationId,
        draft: p.draft as never,
      })
      return res.ok ? toResponse(res) : errResponse(res.error)
    }
    case 'submission.withdraw': {
      const res = await withdrawSubmission({
        teamId,
        authorMemberId: actor.memberId,
        operationId: envelope.operationId,
        submissionId: String(p.submissionId ?? ''),
        revision: Number(p.revision ?? 0),
      })
      return res.ok ? toResponse(res) : errResponse(res.error)
    }
    case 'receipt.submit': {
      const res = await acceptReceipt({
        teamId,
        memberId: actor.memberId,
        operationId: envelope.operationId,
        publicationId: String(p.publicationId ?? ''),
        version: Number(p.version ?? 0),
      })
      return res.ok ? toResponse(res) : errResponse(res.error)
    }
    default:
      return errResponse(`未知动作：${envelope.type}`)
  }
}

// ---------- 编码辅助 ----------

function utf8Bytes(s: string): Bytes {
  return new TextEncoder().encode(s) as Bytes
}
