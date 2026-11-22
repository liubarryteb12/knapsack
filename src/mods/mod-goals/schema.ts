/**
 * mod-goals 数据契约：想法池、目标树（目标→里程碑→任务→周期）与 goal-pack 导入包。
 *
 * 本文件只依赖 zod 与日期工具，不碰 IndexedDB 和 UI，供 App 与 Node 测试共用。
 * 字段定义是唯一真相：docs/GOALS_MODULE_SPEC.md 与 skills/knapsack-goal 必须与之一致。
 */
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { toDateStr } from '../../utils/date'

export const GOAL_PACK_FORMAT = 'goal-pack.v1'
export const GOAL_PACK_SCHEMA_VERSION = 1

export const MAX_GOALS = 20
export const MAX_MILESTONES_PER_GOAL = 6
/** 每个里程碑下的一级任务上限 */
export const MAX_TASKS_PER_MILESTONE = 5
/** 每个任务下的直接子任务上限 */
export const MAX_CHILD_TASKS = 5
/** 任务嵌套深度上限（里程碑下的一级任务算第 1 层） */
export const MAX_TASK_DEPTH = 5
/** 单个里程碑下的任务总数上限（含所有子孙） */
export const MAX_TASKS_PER_MILESTONE_TOTAL = 25
export const MAX_CYCLES = 10

// ---------- 基础类型 ----------

export const goalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 yyyy-MM-dd')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00`)
    return !Number.isNaN(parsed.getTime()) && toDateStr(parsed) === value
  }, '日期不存在')

export const externalIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'externalId 需为英文小写 kebab-case')

export const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), '时间戳无效')

export const ideaStatusSchema = z.enum(['raw', 'clarified', 'promoted', 'parked'])
export const goalStatusSchema = z.enum(['draft', 'active', 'paused', 'done', 'abandoned'])
export const milestoneStatusSchema = z.enum(['todo', 'active', 'done', 'missed'])
export const taskStatusSchema = z.enum(['todo', 'doing', 'done', 'dropped'])
export const horizonSchema = z.enum(['quarter', 'half-year', 'year', 'open'])
export const estimateSchema = z.enum(['S', 'M', 'L'])
export const goalSourceSchema = z.enum(['manual', 'claude-desktop', 'knapsack-ai'])
export const prioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)])
export const roleTierSchema = z.enum(['lead', 'specialist', 'helper'])

// ---------- 看板角色（BoardRole） ----------

export const MAX_ROLES = 12
export const MAX_CHARTER_LENGTH = 500
export const DEFAULT_MAX_DOING = 2

export const boardRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '角色名称不能为空').max(40),
  tier: roleTierSchema.default('specialist'),
  charter: z.string().max(MAX_CHARTER_LENGTH).default(''),
  promptId: z.string().min(1).optional(),
  promptTitle: z.string().max(160).optional(),
  maxDoing: z.number().int().min(1).max(9).default(DEFAULT_MAX_DOING),
  active: z.boolean().default(true),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export type BoardRole = z.infer<typeof boardRoleSchema>
export type RoleTier = z.infer<typeof roleTierSchema>

// ---------- 分派草案（不落库） ----------

export const MAX_DISPATCH_TRAITS = 3

export const dispatchAssignmentSchema = z.object({
  taskId: z.string().min(1),
  roleId: z.string().min(1),
  priority: prioritySchema.default(2),
  traits: z.array(z.string().trim().min(1).max(20)).max(MAX_DISPATCH_TRAITS).default([]),
  reason: z.string().max(40).default(''),
})

export const dispatchUnassignedSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().max(40).default(''),
})

export const dispatchDraftSchema = z.object({
  createdAt: timestampSchema,
  model: z.string().min(1),
  promptId: z.string().min(1).optional(),
  assignments: z.array(dispatchAssignmentSchema).default([]),
  unassigned: z.array(dispatchUnassignedSchema).default([]),
  notes: z.string().max(200).default(''),
})

export type DispatchDraft = z.infer<typeof dispatchDraftSchema>
export type DispatchAssignment = z.infer<typeof dispatchAssignmentSchema>

export class DispatchError extends Error {}

/**
 * 校验草案引用完整性与容量：
 * - taskId / roleId 必须来自输入快照；未知引用整体丢弃并计数
 * - 同一 taskId 不得重复出现
 * - 每个角色的 doing 建议数不得超过 maxDoing，超出记为冲突
 * 返回净化后的草案与问题清单，UI 决定哪些可勾选。
 */
export function validateDispatch(
  draft: DispatchDraft,
  snapshot: {
    taskIds: ReadonlySet<string>
    roles: ReadonlyArray<{ id: string; maxDoing: number }>
    doingCountByRole?: Readonly<Record<string, number>>
    manualRoleByTask?: Readonly<Record<string, string>>
  },
): { clean: DispatchDraft; dropped: Array<{ index: number; reason: string }>; conflicts: string[] } {
  const dropped: Array<{ index: number; reason: string }> = []
  const seenTasks = new Set<string>()
  const roleById = new Map(snapshot.roles.map((role) => [role.id, role]))
  const perRoleCounts = new Map<string, number>()
  const conflicts: string[] = []
  const assignments: DispatchAssignment[] = []

  draft.assignments.forEach((item, index) => {
    if (!snapshot.taskIds.has(item.taskId)) {
      dropped.push({ index, reason: `任务不存在：${item.taskId}` })
      return
    }
    if (!roleById.has(item.roleId)) {
      dropped.push({ index, reason: `人格不存在：${item.roleId}` })
      return
    }
    if (seenTasks.has(item.taskId)) {
      dropped.push({ index, reason: `任务重复分派：${item.taskId}` })
      return
    }
    const manual = snapshot.manualRoleByTask?.[item.taskId]
    if (manual && manual !== item.roleId) {
      dropped.push({ index, reason: `手动分派优先，已保留：${item.taskId}` })
      return
    }
    seenTasks.add(item.taskId)
    perRoleCounts.set(item.roleId, (perRoleCounts.get(item.roleId) ?? 0) + 1)
    assignments.push(item)
  })

  for (const [roleId, count] of perRoleCounts) {
    const role = roleById.get(roleId)
    if (!role) continue
    const doing = snapshot.doingCountByRole?.[roleId] ?? 0
    if (doing + count > role.maxDoing) {
      conflicts.push(`${roleId}：进行中 ${doing} + 建议 ${count} 超过容量 ${role.maxDoing}`)
    }
  }

  return {
    clean: { ...draft, assignments },
    dropped,
    conflicts,
  }
}

// ---------- 实体 ----------

export const ideaSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, '想法标题不能为空'),
  raw: z.string().default(''),
  status: ideaStatusSchema.default('raw'),
  tags: z.array(z.string()).default([]),
  source: goalSourceSchema.default('manual'),
  externalId: externalIdSchema.optional(),
  goalId: z.string().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const goalSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, '目标标题不能为空'),
  why: z.string().default(''),
  successCriteria: z.string().default(''),
  horizon: horizonSchema.default('quarter'),
  startDate: goalDateSchema,
  targetDate: goalDateSchema.optional(),
  status: goalStatusSchema.default('draft'),
  priority: prioritySchema.default(2),
  goalOrder: z.number().int().min(0).optional(),
  sourceIdeaId: z.string().optional(),
  externalId: externalIdSchema.optional(),
  source: goalSourceSchema.default('manual'),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const milestoneSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  title: z.string().trim().min(1, '里程碑标题不能为空'),
  acceptance: z.string().trim().min(1, '里程碑验收口径不能为空'),
  targetDate: goalDateSchema.optional(),
  status: milestoneStatusSchema.default('todo'),
  order: z.number().int().min(0).default(0),
  externalId: externalIdSchema.optional(),
})

export const taskSchema = z.object({
  id: z.string().min(1),
  milestoneId: z.string().min(1),
  /** 子任务指向父任务；缺省 = 里程碑下的一级任务（旧数据天然满足） */
  parentId: z.string().min(1).optional(),
  title: z.string().trim().min(1, '任务标题不能为空'),
  detail: z.string().default(''),
  estimate: estimateSchema.default('M'),
  dueDate: goalDateSchema.optional(),
  cycleId: z.string().optional(),
  status: taskStatusSchema.default('todo'),
  order: z.number().int().min(0).default(0),
  externalId: externalIdSchema.optional(),
  // 看板扩展字段（可缺省，旧数据读出 undefined）
  roleId: z.string().min(1).optional(),
  boardOrder: z.number().int().min(0).optional(),
  boardPriority: prioritySchema.optional(),
})

export const cycleSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  label: z.string().trim().min(1, '周期名称不能为空'),
  startDate: goalDateSchema,
  endDate: goalDateSchema,
  focus: z.string().default(''),
  externalId: externalIdSchema.optional(),
})

// ---------- 导入包（草稿不带本地 id 与时间戳） ----------

export const ideaDraftSchema = z.object({
  externalId: externalIdSchema,
  title: z.string().trim().min(1, '想法标题不能为空'),
  raw: z.string().default(''),
  status: ideaStatusSchema.default('raw'),
  tags: z.array(z.string()).default([]),
  source: goalSourceSchema.default('manual'),
  goalExternalId: externalIdSchema.optional(),
})

/** 任务草稿：children 递归表达子任务（AI 拆解包与人工粘贴共用同一结构） */
export interface TaskDraft {
  externalId: string
  title: string
  detail: string
  estimate: z.infer<typeof estimateSchema>
  dueDate?: string
  cycleExternalId?: string
  status: TaskStatus
  order: number
  /** 子任务（可省略，解析后统一为数组） */
  children?: TaskDraft[]
}

export const taskDraftSchema: z.ZodType<TaskDraft> = z.lazy(() =>
  z.object({
    externalId: externalIdSchema,
    title: z.string().trim().min(1, '任务标题不能为空'),
    detail: z.string().default(''),
    estimate: estimateSchema.default('M'),
    dueDate: goalDateSchema.optional(),
    cycleExternalId: externalIdSchema.optional(),
    status: taskStatusSchema.default('todo'),
    order: z.number().int().min(0).default(0),
    children: z
      .array(taskDraftSchema)
      .max(MAX_CHILD_TASKS, `每个任务最多 ${MAX_CHILD_TASKS} 个子任务`)
      .default([]),
  }),
) as z.ZodType<TaskDraft>

export const milestoneDraftSchema = z.object({
  externalId: externalIdSchema,
  title: z.string().trim().min(1, '里程碑标题不能为空'),
  acceptance: z.string().trim().min(1, '里程碑验收口径不能为空'),
  targetDate: goalDateSchema.optional(),
  status: milestoneStatusSchema.default('todo'),
  order: z.number().int().min(0).default(0),
  tasks: z.array(taskDraftSchema).max(MAX_TASKS_PER_MILESTONE, `每个里程碑最多 ${MAX_TASKS_PER_MILESTONE} 个任务`).default([]),
})

export const goalDraftSchema = z.object({
  externalId: externalIdSchema,
  title: z.string().trim().min(1, '目标标题不能为空'),
  why: z.string().default(''),
  successCriteria: z.string().default(''),
  horizon: horizonSchema.default('quarter'),
  startDate: goalDateSchema,
  targetDate: goalDateSchema.optional(),
  status: goalStatusSchema.default('draft'),
  priority: prioritySchema.default(2),
  source: goalSourceSchema.default('manual'),
  milestones: z
    .array(milestoneDraftSchema)
    .max(MAX_MILESTONES_PER_GOAL, `每个目标最多 ${MAX_MILESTONES_PER_GOAL} 个里程碑`)
    .default([]),
})

export const cycleDraftSchema = z.object({
  externalId: externalIdSchema,
  goalExternalId: externalIdSchema,
  label: z.string().trim().min(1, '周期名称不能为空'),
  startDate: goalDateSchema,
  endDate: goalDateSchema,
  focus: z.string().default(''),
})

function collectExternalIds(pack: z.infer<typeof goalPackBaseSchema>): Array<{ id: string; path: string }> {
  const entries: Array<{ id: string; path: string }> = []
  pack.ideas.forEach((idea, i) => entries.push({ id: idea.externalId, path: `ideas[${i}].externalId` }))
  pack.goals.forEach((goal, gi) => {
    entries.push({ id: goal.externalId, path: `goals[${gi}].externalId` })
    goal.milestones.forEach((milestone, mi) => {
      entries.push({ id: milestone.externalId, path: `goals[${gi}].milestones[${mi}].externalId` })
      const walk = (tasks: readonly TaskDraft[], prefix: string): void => {
        tasks.forEach((task, ti) => {
          const path = `${prefix}[${ti}].externalId`
          entries.push({ id: task.externalId, path })
          walk(task.children ?? [], `${prefix}[${ti}].children`)
        })
      }
      walk(milestone.tasks, `goals[${gi}].milestones[${mi}].tasks`)
    })
  })
  pack.cycles.forEach((cycle, i) => entries.push({ id: cycle.externalId, path: `cycles[${i}].externalId` }))
  return entries
}

const goalPackBaseSchema = z.object({
  format: z.literal(GOAL_PACK_FORMAT, { message: `format 必须为 ${GOAL_PACK_FORMAT}` }),
  schemaVersion: z.literal(GOAL_PACK_SCHEMA_VERSION, {
    message: `schemaVersion 必须为 ${GOAL_PACK_SCHEMA_VERSION}`,
  }),
  source: goalSourceSchema.default('manual'),
  createdAt: timestampSchema,
  assumptions: z.array(z.string()).default([]),
  ideas: z.array(ideaDraftSchema).default([]),
  goals: z.array(goalDraftSchema).max(MAX_GOALS, `导入包最多 ${MAX_GOALS} 个目标`).default([]),
  cycles: z.array(cycleDraftSchema).max(MAX_CYCLES, `导入包最多 ${MAX_CYCLES} 个周期`).default([]),
})

export const goalPackSchema = goalPackBaseSchema.superRefine((pack, ctx) => {
  if (pack.ideas.length === 0 && pack.goals.length === 0 && pack.cycles.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: '导入包至少需要包含 ideas、goals、cycles 中的一项',
      path: [],
    })
  }

  const seen = new Map<string, string>()
  for (const entry of collectExternalIds(pack)) {
    const previous = seen.get(entry.id)
    if (previous) {
      ctx.addIssue({
        code: 'custom',
        message: `externalId 重复：${entry.id}（另见 ${previous}）`,
        path: entry.path.split('.'),
      })
    } else {
      seen.set(entry.id, entry.path)
    }
  }

  for (const [gi, goal] of pack.goals.entries()) {
    if (goal.targetDate && goal.targetDate < goal.startDate) {
      ctx.addIssue({
        code: 'custom',
        message: '目标结束日期不能早于开始日期',
        path: ['goals', gi, 'targetDate'],
      })
    }
  }

  for (const [ci, cycle] of pack.cycles.entries()) {
    if (cycle.endDate < cycle.startDate) {
      ctx.addIssue({
        code: 'custom',
        message: '周期结束日期不能早于开始日期',
        path: ['cycles', ci, 'endDate'],
      })
    }
  }

  // 子任务层级：深度与总量都要受控，避免 AI 输出无限嵌套
  for (const [gi, goal] of pack.goals.entries()) {
    for (const [mi, milestone] of goal.milestones.entries()) {
      let total = 0
      let maxDepth = 0
      const walk = (tasks: readonly TaskDraft[], depth: number): void => {
        for (const task of tasks) {
          total++
          maxDepth = Math.max(maxDepth, depth)
          walk(task.children ?? [], depth + 1)
        }
      }
      walk(milestone.tasks, 1)
      if (maxDepth > MAX_TASK_DEPTH) {
        ctx.addIssue({
          code: 'custom',
          message: `任务层级最多 ${MAX_TASK_DEPTH} 层，当前 ${maxDepth} 层`,
          path: ['goals', gi, 'milestones', mi, 'tasks'],
        })
      }
      if (total > MAX_TASKS_PER_MILESTONE_TOTAL) {
        ctx.addIssue({
          code: 'custom',
          message: `单个里程碑下最多 ${MAX_TASKS_PER_MILESTONE_TOTAL} 个任务（含子任务），当前 ${total} 个`,
          path: ['goals', gi, 'milestones', mi, 'tasks'],
        })
      }
    }
  }
})

/** 递归统计任务草稿总数（含子任务）。 */
export function countTaskDrafts(tasks: readonly TaskDraft[]): number {
  let total = 0
  for (const task of tasks) total += 1 + countTaskDrafts(task.children ?? [])
  return total
}

export type GoalPack = z.infer<typeof goalPackSchema>
export type Idea = z.infer<typeof ideaSchema>
export type Goal = z.infer<typeof goalSchema>
export type Milestone = z.infer<typeof milestoneSchema>
export type Task = z.infer<typeof taskSchema>
export type Cycle = z.infer<typeof cycleSchema>
export type IdeaDraft = z.infer<typeof ideaDraftSchema>
export type GoalDraft = z.infer<typeof goalDraftSchema>
export type MilestoneDraft = z.infer<typeof milestoneDraftSchema>
export type CycleDraft = z.infer<typeof cycleDraftSchema>
export type IdeaStatus = z.infer<typeof ideaStatusSchema>
export type GoalStatus = z.infer<typeof goalStatusSchema>
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>
export type TaskStatus = z.infer<typeof taskStatusSchema>
export type GoalSource = z.infer<typeof goalSourceSchema>

/** 导出全部 externalId，供导入器与本地数据合并校验 */
export function collectPackExternalIds(pack: GoalPack): string[] {
  return collectExternalIds(pack).map((entry) => entry.id)
}

/**
 * 校验跨实体引用：包内或本地已有数据必须能解析。
 * 允许引用本地数据，是为了让「只导入一个新增里程碑」的局部包成立。
 */
export function verifyExternalReferences(pack: GoalPack, known: Iterable<string>): void {
  const knownSet = new Set(known)
  for (const id of collectPackExternalIds(pack)) knownSet.add(id)

  const fail = (message: string): never => {
    throw new GoalPackError(message)
  }

  for (const [gi, idea] of pack.ideas.entries()) {
    if (idea.goalExternalId && !knownSet.has(idea.goalExternalId)) {
      fail(`ideas[${gi}].goalExternalId 指向不存在的目标：${idea.goalExternalId}`)
    }
  }
  for (const [ci, cycle] of pack.cycles.entries()) {
    if (!knownSet.has(cycle.goalExternalId)) {
      fail(`cycles[${ci}].goalExternalId 指向不存在的目标：${cycle.goalExternalId}`)
    }
  }
  for (const [gi, goal] of pack.goals.entries()) {
    for (const [mi, milestone] of goal.milestones.entries()) {
      const walk = (tasks: readonly TaskDraft[], prefix: string): void => {
        for (const [ti, task] of tasks.entries()) {
          if (task.cycleExternalId && !knownSet.has(task.cycleExternalId)) {
            fail(`${prefix}[${ti}].cycleExternalId 指向不存在的周期：${task.cycleExternalId}`)
          }
          walk(task.children ?? [], `${prefix}[${ti}].children`)
        }
      }
      walk(milestone.tasks, `goals[${gi}].milestones[${mi}].tasks`)
    }
  }
}

export class GoalPackError extends Error {}

// ---------- 工厂 ----------

function iso(now: number): string {
  return new Date(now).toISOString()
}

export function newIdea(
  input: { title: string; raw?: string; tags?: string[]; source?: GoalSource; externalId?: string; goalId?: string },
  now = Date.now(),
): Idea {
  return ideaSchema.parse({
    id: nanoid(10),
    title: input.title,
    raw: input.raw ?? '',
    status: 'raw',
    tags: input.tags ?? [],
    source: input.source ?? 'manual',
    externalId: input.externalId,
    goalId: input.goalId,
    createdAt: iso(now),
    updatedAt: iso(now),
  })
}

export function newGoal(
  input: {
    title: string
    why?: string
    successCriteria?: string
    horizon?: z.infer<typeof horizonSchema>
    startDate: string
    targetDate?: string
    priority?: 1 | 2 | 3
    sourceIdeaId?: string
    externalId?: string
    source?: GoalSource
  },
  now = Date.now(),
): Goal {
  return goalSchema.parse({
    id: nanoid(10),
    title: input.title,
    why: input.why ?? '',
    successCriteria: input.successCriteria ?? '',
    horizon: input.horizon ?? 'quarter',
    startDate: input.startDate,
    targetDate: input.targetDate,
    status: 'draft',
    priority: input.priority ?? 2,
    sourceIdeaId: input.sourceIdeaId,
    externalId: input.externalId,
    source: input.source ?? 'manual',
    createdAt: iso(now),
    updatedAt: iso(now),
  })
}

export function newMilestone(
  input: {
    goalId: string
    title: string
    acceptance: string
    targetDate?: string
    order?: number
    externalId?: string
  },
  now = Date.now(),
): Milestone {
  return milestoneSchema.parse({
    id: nanoid(10),
    goalId: input.goalId,
    title: input.title,
    acceptance: input.acceptance,
    targetDate: input.targetDate,
    status: 'todo',
    order: input.order ?? 0,
    externalId: input.externalId,
    createdAt: iso(now),
  })
}

export function newTask(
  input: {
    milestoneId: string
    parentId?: string
    title: string
    detail?: string
    estimate?: z.infer<typeof estimateSchema>
    dueDate?: string
    cycleId?: string
    order?: number
    externalId?: string
  },
  _now = Date.now(),
): Task {
  return taskSchema.parse({
    id: nanoid(10),
    milestoneId: input.milestoneId,
    parentId: input.parentId,
    title: input.title,
    detail: input.detail ?? '',
    estimate: input.estimate ?? 'M',
    dueDate: input.dueDate,
    cycleId: input.cycleId,
    status: 'todo',
    order: input.order ?? 0,
    externalId: input.externalId,
  })
}

export function newCycle(
  input: { goalId: string; label: string; startDate: string; endDate: string; focus?: string; externalId?: string },
  _now = Date.now(),
): Cycle {
  return cycleSchema.parse({
    id: nanoid(10),
    goalId: input.goalId,
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate,
    focus: input.focus ?? '',
    externalId: input.externalId,
  })
}

export function newBoardRole(
  input: {
    name: string
    tier?: z.infer<typeof roleTierSchema>
    charter?: string
    promptId?: string
    promptTitle?: string
    maxDoing?: number
    active?: boolean
  },
  now = Date.now(),
): BoardRole {
  return boardRoleSchema.parse({
    id: nanoid(10),
    name: input.name,
    tier: input.tier ?? 'specialist',
    charter: input.charter ?? '',
    promptId: input.promptId,
    promptTitle: input.promptTitle,
    maxDoing: input.maxDoing ?? DEFAULT_MAX_DOING,
    active: input.active ?? true,
    createdAt: iso(now),
    updatedAt: iso(now),
  })
}

// ---------- 派生进度（不落库） ----------

/** 完成任务占比；没有任务时返回 null，界面显示「未拆解」 */
export function completionRatio(tasks: ReadonlyArray<{ status: TaskStatus }>): number | null {
  if (tasks.length === 0) return null
  return tasks.filter((task) => task.status === 'done').length / tasks.length
}

export function goalCompletionRatio(
  milestones: ReadonlyArray<{ id: string }>,
  tasks: ReadonlyArray<{ status: TaskStatus; milestoneId: string }>,
): number | null {
  const milestoneIds = new Set(milestones.map((milestone) => milestone.id))
  return completionRatio(tasks.filter((task) => milestoneIds.has(task.milestoneId)))
}

// ---------- 工作区快照（BOARD_MODULE_SPEC §12：MCP 平台化导出契约） ----------

export const WORKSPACE_SNAPSHOT_FORMAT = 'workspace-snapshot.v1'
export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = 1

/** 提示词目录投影（与 capabilityContracts.WorkPromptProjection 字段一致，避免跨层依赖） */
export const snapshotPromptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  systemRole: z.string(),
  templateBody: z.string(),
  outputFormat: z.enum(['MARKDOWN', 'JSON', 'TABLE', 'CODE', 'PLAIN']),
  facets: z.object({
    targetTool: z.array(z.string()),
    domainTheme: z.array(z.string()),
    styleTechnique: z.array(z.string()),
  }),
  updatedAt: z.number(),
})

export const workspaceSnapshotSchema = z.object({
  format: z.literal(WORKSPACE_SNAPSHOT_FORMAT, { message: `format 必须为 ${WORKSPACE_SNAPSHOT_FORMAT}` }),
  schemaVersion: z.literal(WORKSPACE_SNAPSHOT_SCHEMA_VERSION, {
    message: `schemaVersion 必须为 ${WORKSPACE_SNAPSHOT_SCHEMA_VERSION}`,
  }),
  createdAt: timestampSchema,
  source: z.literal('knapsack'),
  ideas: z.array(ideaSchema).default([]),
  goals: z.array(goalSchema).default([]),
  milestones: z.array(milestoneSchema).default([]),
  tasks: z.array(taskSchema).default([]),
  cycles: z.array(cycleSchema).default([]),
  roles: z.array(boardRoleSchema).default([]),
  prompts: z.array(snapshotPromptSchema).default([]),
})

export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>
export type SnapshotPrompt = z.infer<typeof snapshotPromptSchema>

/** 快照内引用完整性：milestone.goalId / task.milestoneId / cycle.goalId 必须指向快照内实体 */
export function verifySnapshotReferences(
  snapshot: WorkspaceSnapshot,
): Array<{ path: string; message: string }> {
  const problems: Array<{ path: string; message: string }> = []
  const goalIds = new Set(snapshot.goals.map((goal) => goal.id))
  const milestoneIds = new Set(snapshot.milestones.map((milestone) => milestone.id))
  snapshot.milestones.forEach((milestone, i) => {
    if (!goalIds.has(milestone.goalId)) {
      problems.push({ path: `milestones[${i}].goalId`, message: `目标不存在：${milestone.goalId}` })
    }
  })
  snapshot.tasks.forEach((task, i) => {
    if (!milestoneIds.has(task.milestoneId)) {
      problems.push({ path: `tasks[${i}].milestoneId`, message: `里程碑不存在：${task.milestoneId}` })
    }
    if (task.roleId && !snapshot.roles.some((role) => role.id === task.roleId)) {
      problems.push({ path: `tasks[${i}].roleId`, message: `人格不存在：${task.roleId}` })
    }
  })
  snapshot.cycles.forEach((cycle, i) => {
    if (!goalIds.has(cycle.goalId)) {
      problems.push({ path: `cycles[${i}].goalId`, message: `目标不存在：${cycle.goalId}` })
    }
  })
  return problems
}
