/**
 * Dexie 升级：v2 增加 team 相关表（保留 v1 trips）
 *
 * 表设计（SPEC 5.1 建议的六个实体）：
 * - teamState：团队聚合根，主键 teamId。submissions/expenses 等嵌套在
 *   TeamState 里整体保存（同 trip 的模式），事务用 Dexie 的 transaction 包。
 * - teamPublications：发布快照，主键 publicationId；索引 teamId+version。
 * - teamOutbox：本机待上传/待补回执队列，主键 operationId；索引 teamId, kind, createdAt。
 * - teamIdempotency：主机端幂等结果表，主键 idempotencyKey。
 * - teamLink：本机配对信息（teamId → memberId/凭证引用），主键 teamId。
 *
 * 注意：私人 trips 表的 schema 一字不动；升级必须对旧数据无操作。
 */
import Dexie, { type Table } from 'dexie'
import type { TeamState } from '../domain/schema'
import type { PublicSnapshot, PublicationMeta } from '../domain/schema'
import { KnapsackDB as ExistingDB } from '../../../db/index'
// ---------- Outbox 条目 ----------

/** outbox 类型：提交报告 / 回执 / 加入申请 */
export type OutboxKind = 'submission' | 'receipt' | 'join'

export interface TeamOutboxEntry {
  /** 幂等 operationId，同 ID 重试不重复入队 */
  operationId: string
  teamId: string
  kind: OutboxKind
  /** 业务载荷（已按 canonicalJson 序列化前的原始对象） */
  payload: unknown
  createdAt: number
  /** 补传次数（诊断用，不影响幂等） */
  attempts: number
}

/** 主机端幂等结果（键不含 sessionId/nonce，SPEC 5.2） */
export interface TeamIdempotencyRecord {
  /** `${teamId}|${actorId}|${action}|${operationId}` */
  idempotencyKey: string
  teamId: string
  actorMemberId: string
  action: string
  operationId: string
  /** 规范化业务载荷摘要，用于「同键异载荷」冲突判断 */
  payloadDigest: string
  /** 持久化后的业务结果（如 submissionId+revision、publicationId+version） */
  result: unknown
  createdAt: number
}

/** 本机配对信息（TeamLink） */
export interface TeamLink {
  teamId: string
  /** 主机绑定的稳定 memberId */
  memberId: string
  /** 本机显示名 */
  memberName: string
  /** 加入申请稳定 ID（恢复配对用，SPEC 6.2） */
  joinRequestId: string
  /** 设备配对标识（随机，恢复配对时主机核对） */
  deviceId: string
  /** 主机签发的逐成员凭证；只存本机应用沙箱，不进公共二维码/文件/日志 */
  credential: string
  /** 关联的私人 Trip localTripId（可选，不重建身份） */
  localTripId: string | null
  joinedAt: number
}

export interface TeamPublicationRow {
  /** publicationId */
  publicationId: string
  meta: PublicationMeta
  snapshot: PublicSnapshot
}

/** 扩展后的 DB 类（既有 db 实例通过 upgrade 拿到新表） */
export interface TeamTables {
  teamState: Table<TeamState, string>
  teamPublications: Table<TeamPublicationRow, string>
  teamOutbox: Table<TeamOutboxEntry, string>
  teamIdempotency: Table<TeamIdempotencyRecord, string>
  teamLink: Table<TeamLink, string>
}

// v2 schema 已并入 KnapsackDB（src/db/index.ts）；此函数保留为 no-op 以免误用。
/** @deprecated v2 已在 KnapsackDB 构造函数中声明 */
export function upgradeWithTeam(_db: Dexie): void {
  // v2 schema 已由 src/db/index.ts 直接声明；无需再升级。
}

/** 独立的团队 DB 工厂：测试用 fake-indexeddb 时直接 new（表声明继承自 KnapsackDB v2） */
export class TeamKnapsackDB extends ExistingDB implements TeamTables {
  // Inherited typed accessors come from KnapsackDB. This subclass exists only
  // to keep the historical TeamTables interface for tests and adapters.
}
