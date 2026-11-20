/**
 * 工作区快照组装（BOARD_MODULE_SPEC §12.2 MCP-v1 导出文件桥）。
 *
 * 只读投影：从 Dexie 表读全量目标数据，经 capability 总线拿提示词目录投影，
 * 组装成 workspace-snapshot.v1 并做 schema 校验 + 引用校验。不改库、不碰 UI。
 */
import type { CapabilityBus } from '../../../core/capabilityBus'
import { WORK_PROMPT_CATALOG_TOPIC, type WorkPromptProjection } from '../../../core/capabilityContracts'
import type { Dexie } from 'dexie'
import {
  WORKSPACE_SNAPSHOT_FORMAT,
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  verifySnapshotReferences,
  workspaceSnapshotSchema,
  type BoardRole,
  type Cycle,
  type Goal,
  type Idea,
  type Milestone,
  type SnapshotPrompt,
  type Task,
  type WorkspaceSnapshot,
} from '../schema'

/** 表读取接口：与 store.ts 的 db.table 用法一致，测试可注入内存桩 */
export interface SnapshotTables {
  ideas: Idea[]
  goals: Goal[]
  milestones: Milestone[]
  tasks: Task[]
  cycles: Cycle[]
  roles: BoardRole[]
}

export class SnapshotError extends Error {}

export async function readSnapshotTables(db: Dexie): Promise<SnapshotTables> {
  const [ideas, goals, milestones, tasks, cycles, roles] = await Promise.all([
    db.table<Idea, string>('mod_goals_ideas').toArray(),
    db.table<Goal, string>('mod_goals_goals').toArray(),
    db.table<Milestone, string>('mod_goals_milestones').toArray(),
    db.table<Task, string>('mod_goals_tasks').toArray(),
    db.table<Cycle, string>('mod_goals_cycles').toArray(),
    db.table<BoardRole, string>('mod_goals_roles').toArray(),
  ])
  return { ideas, goals, milestones, tasks, cycles, roles }
}

/** capability 拿不到时提示词目录为空数组——快照导出不因提示词库关闭而失败 */
export async function readPromptProjection(bus: CapabilityBus): Promise<SnapshotPrompt[]> {
  const values = await bus
    .query<WorkPromptProjection[]>(WORK_PROMPT_CATALOG_TOPIC)
    .catch(() => [] as WorkPromptProjection[][])
  return values.flat()
}

export function buildWorkspaceSnapshot(
  tables: SnapshotTables,
  prompts: SnapshotPrompt[],
  now = new Date(),
): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = {
    format: WORKSPACE_SNAPSHOT_FORMAT,
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    source: 'knapsack',
    ideas: [...tables.ideas].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    goals: [...tables.goals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    milestones: [...tables.milestones].sort((a, b) => a.goalId.localeCompare(b.goalId) || a.order - b.order),
    tasks: [...tables.tasks].sort((a, b) => a.milestoneId.localeCompare(b.milestoneId) || a.order - b.order),
    cycles: [...tables.cycles].sort((a, b) => a.goalId.localeCompare(b.goalId) || a.startDate.localeCompare(b.startDate)),
    roles: [...tables.roles].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    prompts: [...prompts].sort((a, b) => a.title.localeCompare(b.title)),
  }

  const parsed = workspaceSnapshotSchema.safeParse(snapshot)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new SnapshotError(`快照契约校验失败：${issue?.path.join('.') || '根'} ${issue?.message ?? ''}`)
  }

  const referenceProblems = verifySnapshotReferences(parsed.data)
  if (referenceProblems.length > 0) {
    const first = referenceProblems[0]!
    throw new SnapshotError(`快照引用不完整：${first.path} ${first.message}`)
  }

  return parsed.data
}

export function serializeSnapshot(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}
