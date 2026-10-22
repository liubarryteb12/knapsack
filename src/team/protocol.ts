/**
 * 团队筹备与汇总 · 协议与领域契约（knapsack-team/1）
 *
 * 这是 SPEC（TEAM_COLLAB_SPEC.md）在代码中的落点，P0 冻结。
 * 要点（均为 SPEC 已定边界，不可在实现时偷偷放宽）：
 * - 独立协议，不塞进 trip.v1；旧 schema 会剥未知字段，未知协议必须拒绝。
 * - 阶段枚举 purchase/carry/count；purchase/carry 的 checkpointId 恒为 null。
 * - 当前确认量逻辑键 (teamId, allocationId, stage, checkpointId) 唯一。
 * - 幂等键不含 sessionId/nonce 等临时连接信息。
 * - 事件发出 ≠ 落库成功；HTTP ACK 只能由 JS handler 完成持久化后给出。
 */

/** 协议标识与版本 */
export const TEAM_PROTOCOL = 'knapsack-team/1'
/** 团队存储 schema 版本（Dexie 表内 format 字段） */
export const TEAM_FORMAT = 'team.v1'
/** 团队发布快照格式（文件兜底与协议共用） */
export const TEAM_PUBLICATION_FORMAT = 'team-publication.v1'
/** 团队报告文件兜底格式 */
export const TEAM_SUBMISSION_FORMAT = 'team-submission.v1'
/** 文件兜底扩展名（P0 冻结，与 .trip 区分） */
export const TEAM_PUBLIC_EXT = '.team-public'
export const TEAM_SUBMIT_EXT = '.team-submit'
/**
 * 请求体上限（字节），无附件。
 * TS 侧不直接校验：实际执行点在 android/.../TeamHostPlugin.java 的
 * MAX_BODY_BYTES（超出 413）。两侧值必须一致，改动时同步。
 */
export const TEAM_MAX_BODY_BYTES = 1024 * 1024
/**
 * handler 处理单请求超时（毫秒），超时原生必须返回失败，不得挂死。
 * 实际执行点在 TeamHostPlugin.java 的 HANDLER_TIMEOUT_MS（504）。
 */
export const TEAM_HANDLER_TIMEOUT_MS = 20000

// ---------- ID 形态（全部 nanoid，稳定不变） ----------

/** 生成稳定业务 ID；统一出口便于测试时替换 */
export function newId(): string {
  // 直接 import 会在脚本环境拉入 ESM-only 的 nanoid，这里保持同构
  // nanoid 默认导出即是函数
  return nanoidFn(12)
}

// nanoid 延迟绑定，避免循环依赖问题；模块加载即初始化
import { nanoid as nanoidFn } from 'nanoid'

// ---------- 阶段与逻辑键 ----------

import { z } from 'zod'

/** 三阶段：采购 / 携带 / 清点 */
export type TeamStage = 'purchase' | 'carry' | 'count'

/** 阶段枚举的唯一事实源：schema.ts 从这里复用，避免两份定义漂移 */
export const TEAM_STAGE_SCHEMA = z.enum(['purchase', 'carry', 'count'])

/** 当前确认量唯一逻辑键；purchase/carry 的 checkpointId 固定 null */
export interface ConfirmKey {
  allocationId: string
  stage: TeamStage
  checkpointId: string | null
}

/** 规范化逻辑键字符串（用于唯一索引与去重判断） */
export function confirmKeyString(k: ConfirmKey): string {
  return `${k.allocationId}|${k.stage}|${k.checkpointId ?? ''}`
}

/** 校验阶段与 checkpointId 的配套关系（SPEC 3.3） */
export function isConsistentKey(stage: TeamStage, checkpointId: string | null): boolean {
  if (stage === 'count') return checkpointId !== null
  return checkpointId === null
}

// ---------- 幂等动作 ----------

/** 动作类型：幂等键 = (teamId, actorId, action, operationId) */
export type TeamActionType =
  | 'submission.submit'   // 提交/修订报告
  | 'submission.withdraw' // 撤回
  | 'confirm.decision'    // 主机确认/退回
  | 'publication.publish' // 发布
  | 'receipt.submit'      // 领取回执
  | 'join.request'        // 申请加入
  | 'expense.confirm'     // 费用确认/修订
