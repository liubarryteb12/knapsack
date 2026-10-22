/**
 * 团队协议 · 消息信封与响应（knapsack-team/1）
 *
 * 传输与加密在 identity.ts（ECDH + AAD）与 teamClient.ts / teamHostService.ts。
 * 本文件只定义消息形状与动作名，不含密码逻辑，便于两侧共用。
 */

import { TEAM_PROTOCOL } from './protocol'
export { TEAM_PROTOCOL }

/** 所有加密消息的公共头；sessionId 由 AAD 绑定，不在载荷里重复 */
export interface TeamEnvelope {
  protocol: typeof TEAM_PROTOCOL
  schemaVersion: 1
  teamId: string
  operationId: string
  type: TeamActionName
  payload: unknown
}

export type TeamActionName =
  | 'join.request'
  | 'join.status'
  | 'assignment.fetch'
  | 'submission.submit'
  | 'submission.status'
  | 'publication.latest'
  | 'publication.fetch'
  | 'receipt.submit'
  | 'task.ack'

/** 身份声明：由凭证证明，主机从凭证推导作者，不采信自报身份 */
export interface ActorClaimPayload {
  memberId: string
  deviceId: string
  credential: string
}

export function makeEnvelope(
  teamId: string,
  operationId: string,
  type: TeamActionName,
  payload: unknown,
): TeamEnvelope {
  return { protocol: TEAM_PROTOCOL, schemaVersion: 1, teamId, operationId, type, payload }
}

/** 响应：成功带 result；失败带 error（人话） */
export interface TeamResponse {
  ok: boolean
  result?: unknown
  error?: string
  /** 幂等命中标记，便于调用方区分新建/重放 */
  replay?: boolean
}

export function okResponse(result: unknown, replay = false): TeamResponse {
  return { ok: true, result, replay }
}

export function errResponse(error: string): TeamResponse {
  return { ok: false, error }
}
