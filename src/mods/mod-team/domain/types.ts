/**
 * 团队领域类型聚合出口。schema.ts 的 z.infer 类型 + protocol 的键类型。
 */
export type {
  PublicSnapshot,
  PublicationMeta,
  Submission,
  TeamAllocation,
  TeamCheckpoint,
  TeamExpense,
  TeamItem,
  TeamMember,
  TeamState,
  TeamRole,
  ReviewState,
  UploadState,
} from './schema'

export type { ConfirmKey, TeamStage, TeamActionType } from './protocol'
export { confirmKeyString, isConsistentKey } from './protocol'
