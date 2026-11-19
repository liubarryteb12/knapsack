import { nanoid } from 'nanoid'
import { db } from '../../../db'
import {
  GoalPackError,
  collectPackExternalIds,
  goalPackSchema,
  newCycle,
  newGoal,
  newIdea,
  newMilestone,
  newTask,
  verifyExternalReferences,
  type Cycle,
  type Goal,
  type GoalPack,
  type Idea,
  type Milestone,
  type Task,
} from '../schema'
import { sha256Hex } from './ids'

export interface LocalSnapshot {
  ideas: Idea[]
  goals: Goal[]
  milestones: Milestone[]
  tasks: Task[]
  cycles: Cycle[]
}

export interface ImportCounts {
  create: number
  update: number
}

export interface ImportCountsByType {
  ideas: ImportCounts
  goals: ImportCounts
  milestones: ImportCounts
  tasks: ImportCounts
  cycles: ImportCounts
}

export interface ImportPlan {
  pack: GoalPack
  ideas: Idea[]
  goals: Goal[]
  milestones: Milestone[]
  tasks: Task[]
  cycles: Cycle[]
  counts: ImportCountsByType
  /** 本地已有、本包未包含的项：只提示，不删除 */
  missing: { milestones: number; tasks: number }
  warnings: string[]
  digest: string
  idempotencyKey: string
}

export interface ImportRecord {
  id: string
  importedAt: string
  source: GoalPack['source']
  schemaVersion: number
  promptVersion?: number
  idempotencyKey: string
  packDigest: string
  summary: ImportCountsByType
}

const ideasTable = () => db.table<Idea, string>('mod_goals_ideas')
const goalsTable = () => db.table<Goal, string>('mod_goals_goals')
const milestonesTable = () => db.table<Milestone, string>('mod_goals_milestones')
const tasksTable = () => db.table<Task, string>('mod_goals_tasks')
const cyclesTable = () => db.table<Cycle, string>('mod_goals_cycles')
const importsTable = () => db.table<ImportRecord, string>('mod_goals_imports')

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function iso(now: number): string {
  return new Date(now).toISOString()
}

function emptyCounts(): ImportCountsByType {
  return {
    ideas: { create: 0, update: 0 },
    goals: { create: 0, update: 0 },
    milestones: { create: 0, update: 0 },
    tasks: { create: 0, update: 0 },
    cycles: { create: 0, update: 0 },
  }
}

/** 解析宽松、校验严格：容忍围栏与前后废话，字段不合规一律拒绝 */
export function parseGoalPackText(text: string): GoalPack {
  const trimmed = text.trim()
  if (!trimmed) throw new GoalPackError('内容为空，请先粘贴 goal-pack')

  let raw = trimmed
  const fence = /```[a-zA-Z0-9-]*\s*([\s\S]*?)```/.exec(trimmed)
  if (fence?.[1]) raw = fence[1].trim()

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new GoalPackError('找不到 JSON 对象，请检查粘贴内容')

  let json: unknown
  try {
    json = JSON.parse(raw.slice(start, end + 1))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new GoalPackError(`不是合法 JSON：${message}`)
  }

  const parsed = goalPackSchema.safeParse(json)
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join('.') || '根'}：${issue.message}`)
      .join('\n')
    throw new GoalPackError(`goal-pack 校验失败：\n${details}`)
  }
  return parsed.data
}

export function readLocalSnapshot(snapshot: LocalSnapshot): string[] {
  const ids: string[] = []
  for (const item of [...snapshot.ideas, ...snapshot.goals, ...snapshot.milestones, ...snapshot.tasks, ...snapshot.cycles]) {
    if (item.externalId) ids.push(item.externalId)
  }
  return ids
}

export async function loadLocalSnapshot(): Promise<LocalSnapshot> {
  const [ideas, goals, milestones, tasks, cycles] = await Promise.all([
    ideasTable().toArray(),
    goalsTable().toArray(),
    milestonesTable().toArray(),
    tasksTable().toArray(),
    cyclesTable().toArray(),
  ])
  return { ideas, goals, milestones, tasks, cycles }
}

/**
 * 纯规划：不写库，只比对本地数据并产出待写入实体。
 * 匹配只按 externalId；命中更新内容字段，永不覆盖本地 status。
 */
export async function buildImportPlan(pack: GoalPack, local: LocalSnapshot): Promise<ImportPlan> {
  verifyExternalReferences(pack, readLocalSnapshot(local))

  const now = Date.now()
  const timestamp = iso(now)
  const counts = emptyCounts()
  const warnings: string[] = []
  const idMap = new Map<string, string>()

  for (const idea of local.ideas) if (idea.externalId) idMap.set(idea.externalId, idea.id)
  for (const goal of local.goals) if (goal.externalId) idMap.set(goal.externalId, goal.id)
  for (const milestone of local.milestones) if (milestone.externalId) idMap.set(milestone.externalId, milestone.id)
  for (const task of local.tasks) if (task.externalId) idMap.set(task.externalId, task.id)
  for (const cycle of local.cycles) if (cycle.externalId) idMap.set(cycle.externalId, cycle.id)

  const existingIdeas = new Map(local.ideas.filter((i) => i.externalId).map((i) => [i.externalId!, i]))
  const existingGoals = new Map(local.goals.filter((g) => g.externalId).map((g) => [g.externalId!, g]))
  const existingMilestones = new Map(
    local.milestones.filter((m) => m.externalId).map((m) => [m.externalId!, m]),
  )
  const existingTasks = new Map(local.tasks.filter((t) => t.externalId).map((t) => [t.externalId!, t]))
  const existingCycles = new Map(local.cycles.filter((c) => c.externalId).map((c) => [c.externalId!, c]))

  // ---------- 目标 ----------
  const goals: Goal[] = []
  for (const draft of pack.goals) {
    const existing = existingGoals.get(draft.externalId)
    if (existing) {
      const next: Goal = {
        ...existing,
        title: draft.title,
        why: draft.why,
        successCriteria: draft.successCriteria,
        horizon: draft.horizon,
        startDate: draft.startDate,
        targetDate: draft.targetDate,
        priority: draft.priority,
        source: pack.source,
        externalId: draft.externalId,
        updatedAt: timestamp,
      }
      goals.push(next)
      counts.goals.update++
      idMap.set(draft.externalId, existing.id)
    } else {
      const created = newGoal(
        {
          title: draft.title,
          why: draft.why,
          successCriteria: draft.successCriteria,
          horizon: draft.horizon,
          startDate: draft.startDate,
          targetDate: draft.targetDate,
          priority: draft.priority,
          source: pack.source,
          externalId: draft.externalId,
        },
        now,
      )
      const next: Goal = { ...created, status: draft.status }
      goals.push(next)
      counts.goals.create++
      idMap.set(draft.externalId, next.id)
    }
  }

  // ---------- 周期 ----------
  const cycles: Cycle[] = []
  for (const draft of pack.cycles) {
    const goalId = idMap.get(draft.goalExternalId)
    if (!goalId) throw new GoalPackError(`周期「${draft.label}」找不到所属目标：${draft.goalExternalId}`)
    const existing = existingCycles.get(draft.externalId)
    if (existing) {
      const next: Cycle = {
        ...existing,
        goalId,
        label: draft.label,
        startDate: draft.startDate,
        endDate: draft.endDate,
        focus: draft.focus,
        externalId: draft.externalId,
      }
      cycles.push(next)
      counts.cycles.update++
      idMap.set(draft.externalId, existing.id)
    } else {
      const next = newCycle(
        {
          goalId,
          label: draft.label,
          startDate: draft.startDate,
          endDate: draft.endDate,
          focus: draft.focus,
          externalId: draft.externalId,
        },
        now,
      )
      cycles.push(next)
      counts.cycles.create++
      idMap.set(draft.externalId, next.id)
    }
  }

  // ---------- 里程碑 ----------
  const milestones: Milestone[] = []
  for (const goalDraft of pack.goals) {
    const goalId = idMap.get(goalDraft.externalId)
    if (!goalId) throw new GoalPackError(`目标「${goalDraft.title}」未解析出本地 id`)
    for (const draft of goalDraft.milestones) {
      const existing = existingMilestones.get(draft.externalId)
      if (existing) {
        const next: Milestone = {
          ...existing,
          goalId,
          title: draft.title,
          acceptance: draft.acceptance,
          targetDate: draft.targetDate,
          order: draft.order,
          externalId: draft.externalId,
        }
        milestones.push(next)
        counts.milestones.update++
        idMap.set(draft.externalId, existing.id)
      } else {
        const next = newMilestone(
          {
            goalId,
            title: draft.title,
            acceptance: draft.acceptance,
            targetDate: draft.targetDate,
            order: draft.order,
            externalId: draft.externalId,
          },
          now,
        )
        milestones.push({ ...next, status: draft.status })
        counts.milestones.create++
        idMap.set(draft.externalId, next.id)
      }
    }
  }

  // ---------- 任务 ----------
  const tasks: Task[] = []
  for (const goalDraft of pack.goals) {
    for (const milestoneDraft of goalDraft.milestones) {
      const milestoneId = idMap.get(milestoneDraft.externalId)
      if (!milestoneId) throw new GoalPackError(`里程碑「${milestoneDraft.title}」未解析出本地 id`)
      for (const draft of milestoneDraft.tasks) {
        const cycleId = draft.cycleExternalId ? idMap.get(draft.cycleExternalId) : undefined
        if (draft.cycleExternalId && !cycleId) {
          throw new GoalPackError(`任务「${draft.title}」找不到所属周期：${draft.cycleExternalId}`)
        }
        const existing = existingTasks.get(draft.externalId)
        if (existing) {
          const next: Task = {
            ...existing,
            milestoneId,
            title: draft.title,
            detail: draft.detail,
            estimate: draft.estimate,
            dueDate: draft.dueDate,
            cycleId,
            order: draft.order,
            externalId: draft.externalId,
          }
          tasks.push(next)
          counts.tasks.update++
          idMap.set(draft.externalId, existing.id)
        } else {
          const next = newTask(
            {
              milestoneId,
              title: draft.title,
              detail: draft.detail,
              estimate: draft.estimate,
              dueDate: draft.dueDate,
              cycleId,
              order: draft.order,
              externalId: draft.externalId,
            },
            now,
          )
          tasks.push({ ...next, status: draft.status })
          counts.tasks.create++
          idMap.set(draft.externalId, next.id)
        }
      }
    }
  }

  // ---------- 想法 ----------
  const ideas: Idea[] = []
  for (const draft of pack.ideas) {
    const goalId = draft.goalExternalId ? idMap.get(draft.goalExternalId) : undefined
    if (draft.goalExternalId && !goalId) {
      throw new GoalPackError(`想法「${draft.title}」找不到所属目标：${draft.goalExternalId}`)
    }
    const existing = existingIdeas.get(draft.externalId)
    if (existing) {
      const next: Idea = {
        ...existing,
        title: draft.title,
        raw: draft.raw,
        tags: draft.tags,
        source: pack.source,
        externalId: draft.externalId,
        goalId: goalId ?? existing.goalId,
        updatedAt: timestamp,
      }
      ideas.push(next)
      counts.ideas.update++
      idMap.set(draft.externalId, existing.id)
    } else {
      const created = newIdea(
        {
          title: draft.title,
          raw: draft.raw,
          tags: draft.tags,
          source: pack.source,
          externalId: draft.externalId,
          goalId,
        },
        now,
      )
      ideas.push({ ...created, status: draft.status })
      counts.ideas.create++
      idMap.set(draft.externalId, created.id)
    }
  }

  // ---------- 未包含的已有项 ----------
  const packMilestoneIds = new Set(pack.goals.flatMap((g) => g.milestones.map((m) => m.externalId)))
  const packTaskIds = new Set(
    pack.goals.flatMap((g) => g.milestones.flatMap((m) => m.tasks.map((t) => t.externalId))),
  )
  const importedGoalIds = new Set(goals.map((goal) => goal.id))
  const missingMilestones = local.milestones.filter(
    (milestone) =>
      importedGoalIds.has(milestone.goalId) &&
      milestone.externalId &&
      !packMilestoneIds.has(milestone.externalId),
  )
  const missingMilestoneIds = new Set(missingMilestones.map((m) => m.id))
  const importedMilestoneIds = new Set(
    local.milestones.filter((m) => importedGoalIds.has(m.goalId)).map((m) => m.id),
  )
  const missingTasks = local.tasks.filter(
    (task) =>
      missingMilestoneIds.has(task.milestoneId) ||
      (importedMilestoneIds.has(task.milestoneId) &&
        (!task.externalId || !packTaskIds.has(task.externalId))),
  )

  if (missingMilestones.length > 0 || missingTasks.length > 0) {
    warnings.push(
      `本包未包含 ${missingMilestones.length} 个已有里程碑、${missingTasks.length} 个已有任务，导入不会删除它们。`,
    )
  }

  const digest = await sha256Hex(JSON.stringify(pack))
  const idempotencyKey = await sha256Hex(
    `${pack.source}|${[...collectPackExternalIds(pack)].sort().join(',')}|${digest}`,
  )

  return {
    pack,
    ideas,
    goals,
    milestones,
    tasks,
    cycles,
    counts,
    missing: { milestones: missingMilestones.length, tasks: missingTasks.length },
    warnings,
    digest,
    idempotencyKey,
  }
}

/** 事务写入：任何一条失败整体回滚，并留下导入记录 */
export async function commitImport(
  plan: ImportPlan,
  meta: { promptVersion?: number } = {},
): Promise<ImportRecord> {
  const record: ImportRecord = {
    id: nanoid(12),
    importedAt: new Date().toISOString(),
    source: plan.pack.source,
    schemaVersion: plan.pack.schemaVersion,
    promptVersion: meta.promptVersion,
    idempotencyKey: plan.idempotencyKey,
    packDigest: plan.digest,
    summary: plan.counts,
  }

  await db.transaction(
    'rw',
    [ideasTable(), goalsTable(), milestonesTable(), tasksTable(), cyclesTable(), importsTable()],
    async () => {
      if (plan.ideas.length) await ideasTable().bulkPut(plain(plan.ideas))
      if (plan.goals.length) await goalsTable().bulkPut(plain(plan.goals))
      if (plan.milestones.length) await milestonesTable().bulkPut(plain(plan.milestones))
      if (plan.tasks.length) await tasksTable().bulkPut(plain(plan.tasks))
      if (plan.cycles.length) await cyclesTable().bulkPut(plain(plan.cycles))
      await importsTable().put(plain(record))
    },
  )

  return record
}

export async function findPreviousImport(idempotencyKey: string): Promise<ImportRecord | undefined> {
  return importsTable().where('idempotencyKey').equals(idempotencyKey).first()
}

export async function listImports(limit = 20): Promise<ImportRecord[]> {
  const all = await importsTable().orderBy('importedAt').reverse().limit(limit).toArray()
  return all
}
