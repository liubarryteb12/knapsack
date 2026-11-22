import { defineStore } from 'pinia'
import { db } from '../../db'
import { todayStr } from '../../utils/date'
import {
  MAX_TASK_DEPTH,
  goalCompletionRatio,
  newBoardRole,
  newCycle,
  newGoal,
  newIdea,
  newMilestone,
  newTask,
  boardRoleSchema,
  type BoardRole,
  type RoleTier,
  type Cycle,
  type Goal,
  type GoalStatus,
  type Idea,
  type IdeaStatus,
  type Milestone,
  type Task,
  type TaskStatus,
} from './schema'

const ideasTable = () => db.table<Idea, string>('mod_goals_ideas')
const goalsTable = () => db.table<Goal, string>('mod_goals_goals')
const milestonesTable = () => db.table<Milestone, string>('mod_goals_milestones')
const tasksTable = () => db.table<Task, string>('mod_goals_tasks')
const cyclesTable = () => db.table<Cycle, string>('mod_goals_cycles')
const rolesTable = () => db.table<BoardRole, string>('mod_goals_roles')

function isoNow(): string {
  return new Date().toISOString()
}

/** Pinia state 是响应式 Proxy，IndexedDB 无法结构化克隆，写库前必须转成纯对象 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useGoalsStore = defineStore('goals', {
  state: () => ({
    ideas: [] as Idea[],
    goals: [] as Goal[],
    milestones: [] as Milestone[],
    tasks: [] as Task[],
    cycles: [] as Cycle[],
    roles: [] as BoardRole[],
    loading: false,
    error: '',
    loaded: false,
  }),

  getters: {
    activeIdeas(state): Idea[] {
      return [...state.ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    goalsSorted(state): Goal[] {
      const rank: Record<GoalStatus, number> = {
        active: 0,
        draft: 1,
        paused: 2,
        done: 3,
        abandoned: 4,
      }
      // 手动序优先（goalOrder），从未拖过序时回退到状态/优先级自动排序
      const manual = (a: Goal, b: Goal) =>
        (a.goalOrder ?? Number.MAX_SAFE_INTEGER) - (b.goalOrder ?? Number.MAX_SAFE_INTEGER)
      const auto = (a: Goal, b: Goal) =>
        rank[a.status] - rank[b.status] ||
        a.priority - b.priority ||
        (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31')
      return [...state.goals].sort((a, b) => manual(a, b) || auto(a, b))
    },
    goalById(state) {
      return (id: string): Goal | undefined => state.goals.find((goal) => goal.id === id)
    },
    milestonesOf(state) {
      return (goalId: string): Milestone[] =>
        state.milestones.filter((m) => m.goalId === goalId).sort((a, b) => a.order - b.order)
    },
    /** 里程碑下全部任务（含子任务），用于进度、看板与统计 */
    tasksOf(state) {
      return (milestoneId: string): Task[] =>
        state.tasks.filter((t) => t.milestoneId === milestoneId).sort((a, b) => a.order - b.order)
    },
    /** 里程碑下的一级任务（parentId 为空） */
    rootTasksOf(state) {
      return (milestoneId: string): Task[] =>
        state.tasks
          .filter((t) => t.milestoneId === milestoneId && !t.parentId)
          .sort((a, b) => a.order - b.order)
    },
    /** 某个任务的直接子任务 */
    childTasksOf(state) {
      return (parentId: string): Task[] =>
        state.tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.order - b.order)
    },
    taskById(state) {
      return (id: string): Task | undefined => state.tasks.find((t) => t.id === id)
    },
    /** 任务深度：里程碑下一级任务为 1 */
    taskDepth(state) {
      return (taskId: string): number => {
        let depth = 0
        let cursor = state.tasks.find((t) => t.id === taskId)
        const seen = new Set<string>()
        while (cursor && !seen.has(cursor.id)) {
          seen.add(cursor.id)
          depth++
          cursor = cursor.parentId ? state.tasks.find((t) => t.id === cursor!.parentId) : undefined
        }
        return depth
      }
    },
    /** 任务及其全部子孙 id（含自身） */
    taskDescendantIds(state) {
      return (taskId: string): string[] => {
        const childrenByParent = new Map<string, Task[]>()
        for (const task of state.tasks) {
          if (!task.parentId) continue
          const list = childrenByParent.get(task.parentId)
          if (list) list.push(task)
          else childrenByParent.set(task.parentId, [task])
        }
        const out: string[] = []
        const stack = [taskId]
        const seen = new Set<string>()
        while (stack.length > 0) {
          const id = stack.pop()!
          if (seen.has(id)) continue
          seen.add(id)
          out.push(id)
          for (const child of childrenByParent.get(id) ?? []) stack.push(child.id)
        }
        return out
      }
    },
    cyclesOf(state) {
      return (goalId: string): Cycle[] =>
        state.cycles.filter((c) => c.goalId === goalId).sort((a, b) => a.startDate.localeCompare(b.startDate))
    },
    goalProgress(state) {
      return (goalId: string): number | null => {
        const milestones = state.milestones.filter((m) => m.goalId === goalId)
        return goalCompletionRatio(milestones, state.tasks)
      }
    },
    unassignedTasks(state) {
      return (goalId: string): Task[] => {
        const milestoneIds = new Set(
          state.milestones.filter((m) => m.goalId === goalId).map((m) => m.id),
        )
        return state.tasks
          .filter((t) => milestoneIds.has(t.milestoneId) && !t.cycleId)
          .sort((a, b) => a.order - b.order)
      }
    },
    activeGoalIds(state): Set<string> {
      return new Set(state.goals.filter((g) => g.status === 'active').map((g) => g.id))
    },
    /** 看板用：active 目标下、状态可上板的任务，按列排序 */
    boardTasksByStatus(state) {
      return (status: TaskStatus, goalId?: string, roleId?: string): Task[] => {
        const activeIds = new Set(state.goals.filter((g) => g.status === 'active').map((g) => g.id))
        const milestoneById = new Map(state.milestones.map((m) => [m.id, m]))
        return state.tasks
          .filter((t) => {
            if (t.status !== status) return false
            const milestone = milestoneById.get(t.milestoneId)
            if (!milestone) return false
            if (goalId && milestone.goalId !== goalId) return false
            if (roleId && t.roleId !== roleId) return false
            return activeIds.has(milestone.goalId)
          })
          .sort(
            (a, b) =>
              (a.boardOrder ?? a.order) - (b.boardOrder ?? b.order) ||
              a.milestoneId.localeCompare(b.milestoneId),
          )
      }
    },
    roleById(state) {
      return (id: string): BoardRole | undefined => state.roles.find((role) => role.id === id)
    },
    activeRoles(state): BoardRole[] {
      return state.roles
        .filter((role) => role.active)
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    doingCountByRole(state): Record<string, number> {
      const counts: Record<string, number> = {}
      for (const task of state.tasks) {
        if (task.status === 'doing' && task.roleId) {
          counts[task.roleId] = (counts[task.roleId] ?? 0) + 1
        }
      }
      return counts
    },
    /** 目标在看板上是否缺任务（active 且无任务 → 未拆解提示） */
    activeGoalsWithoutTasks(state): Goal[] {
      const activeGoals = state.goals.filter((g) => g.status === 'active')
      const milestoneGoalIds = new Set(state.milestones.map((m) => m.goalId))
      return activeGoals.filter((g) => {
        if (milestoneGoalIds.has(g.id)) return false
        return true
      })
    },
  },

  actions: {
    async loadAll(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        const [ideas, goals, milestones, tasks, cycles, roles] = await Promise.all([
          ideasTable().toArray(),
          goalsTable().toArray(),
          milestonesTable().toArray(),
          tasksTable().toArray(),
          cyclesTable().toArray(),
          rolesTable().toArray(),
        ])
        this.ideas = ideas
        this.goals = goals
        this.milestones = milestones
        this.tasks = tasks
        this.cycles = cycles
        this.roles = roles
        this.loaded = true
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        this.loading = false
      }
    },

    // ---------- 想法 ----------

    async createIdea(input: { title: string; raw?: string; tags?: string[] }): Promise<Idea> {
      const idea = newIdea(input)
      await ideasTable().put(idea)
      this.ideas = [idea, ...this.ideas]
      return idea
    },

    async updateIdea(
      id: string,
      patch: Partial<Pick<Idea, 'title' | 'raw' | 'tags' | 'status' | 'goalId'>>,
    ): Promise<void> {
      const current = this.ideas.find((idea) => idea.id === id)
      if (!current) throw new Error('想法不存在')
      const next: Idea = { ...current, ...patch, updatedAt: isoNow() }
      await ideasTable().put(plain(next))
      this.ideas = this.ideas.map((idea) => (idea.id === id ? next : idea))
    },

    async setIdeaStatus(id: string, status: IdeaStatus): Promise<void> {
      await this.updateIdea(id, { status })
    },

    async deleteIdea(id: string): Promise<void> {
      await ideasTable().delete(id)
      this.ideas = this.ideas.filter((idea) => idea.id !== id)
    },

    /** 想法晋级：同一事务内建目标并回填 goalId，原始讨论不丢 */
    async promoteIdea(ideaId: string): Promise<Goal> {
      const idea = this.ideas.find((item) => item.id === ideaId)
      if (!idea) throw new Error('想法不存在')

      const goal = newGoal({
        title: idea.title,
        why: idea.raw.slice(0, 120),
        startDate: todayStr(),
        sourceIdeaId: idea.id,
      })
      const nextIdea: Idea = {
        ...idea,
        status: 'promoted',
        goalId: goal.id,
        updatedAt: isoNow(),
      }

      await db.transaction('rw', goalsTable(), ideasTable(), async () => {
        await goalsTable().put(goal)
        await ideasTable().put(plain(nextIdea))
      })

      this.goals = [goal, ...this.goals]
      this.ideas = this.ideas.map((item) => (item.id === ideaId ? nextIdea : item))
      return goal
    },

    // ---------- 目标 ----------

    async createGoal(input: {
      title: string
      why?: string
      successCriteria?: string
      startDate?: string
      targetDate?: string
      priority?: 1 | 2 | 3
    }): Promise<Goal> {
      const goal = newGoal({ ...input, startDate: input.startDate ?? todayStr() })
      // 已进入手动排序时，新目标追加到末尾，避免插到最前
      if (this.goals.some((g) => g.goalOrder !== undefined)) {
        goal.goalOrder = Math.max(-1, ...this.goals.map((g) => g.goalOrder ?? -1)) + 1
      }
      await goalsTable().put(plain(goal))
      this.goals = [goal, ...this.goals]
      return goal
    },

    async updateGoal(id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>): Promise<void> {
      const current = this.goals.find((goal) => goal.id === id)
      if (!current) throw new Error('目标不存在')
      const next: Goal = { ...current, ...patch, updatedAt: isoNow() }
      await goalsTable().put(plain(next))
      this.goals = this.goals.map((goal) => (goal.id === id ? next : goal))
    },

    async deleteGoal(id: string): Promise<void> {
      const milestoneIds = this.milestones.filter((m) => m.goalId === id).map((m) => m.id)
      await db.transaction('rw', goalsTable(), milestonesTable(), tasksTable(), cyclesTable(), async () => {
        await tasksTable().bulkDelete(this.tasks.filter((t) => milestoneIds.includes(t.milestoneId)).map((t) => t.id))
        await milestonesTable().bulkDelete(milestoneIds)
        await cyclesTable().bulkDelete(this.cycles.filter((c) => c.goalId === id).map((c) => c.id))
        await goalsTable().delete(id)
      })
      this.goals = this.goals.filter((goal) => goal.id !== id)
      this.milestones = this.milestones.filter((m) => m.goalId !== id)
      this.tasks = this.tasks.filter((t) => !milestoneIds.includes(t.milestoneId))
      this.cycles = this.cycles.filter((c) => c.goalId !== id)
    },

    /** 手动排序目标：按传入顺序重编 goalOrder；未拖过序的目标在首次排序时一并入册 */
    async reorderGoals(orderedIds: string[]): Promise<void> {
      const updates: Goal[] = []
      orderedIds.forEach((id, index) => {
        const current = this.goals.find((goal) => goal.id === id)
        if (current) updates.push({ ...current, goalOrder: index })
      })
      if (updates.length === 0) return
      await db.transaction('rw', goalsTable(), async () => {
        await goalsTable().bulkPut(plain(updates))
      })
      const map = new Map(updates.map((goal) => [goal.id, goal]))
      this.goals = this.goals.map((goal) => map.get(goal.id) ?? goal)
    },

    // ---------- 里程碑 ----------

    async addMilestone(goalId: string, input: { title: string; acceptance: string; targetDate?: string }): Promise<Milestone> {
      const order = this.milestonesOf(goalId).length
      const milestone = newMilestone({ goalId, ...input, order })
      await milestonesTable().put(milestone)
      this.milestones = [...this.milestones, milestone]
      return milestone
    },

    async updateMilestone(id: string, patch: Partial<Omit<Milestone, 'id' | 'goalId'>>): Promise<void> {
      const current = this.milestones.find((m) => m.id === id)
      if (!current) throw new Error('里程碑不存在')
      const next: Milestone = { ...current, ...patch }
      await milestonesTable().put(plain(next))
      this.milestones = this.milestones.map((m) => (m.id === id ? next : m))
    },

    async reorderMilestones(goalId: string, orderedIds: string[]): Promise<void> {
      const updates: Milestone[] = []
      orderedIds.forEach((id, index) => {
        const current = this.milestones.find((m) => m.id === id && m.goalId === goalId)
        if (current) updates.push({ ...current, order: index })
      })
      if (updates.length === 0) return
      await db.transaction('rw', milestonesTable(), async () => {
        await milestonesTable().bulkPut(plain(updates))
      })
      const map = new Map(updates.map((milestone) => [milestone.id, milestone]))
      this.milestones = this.milestones.map((milestone) => map.get(milestone.id) ?? milestone)
    },

    /** 物理删除里程碑并级联其任务，随后重排剩余里程碑序号 */
    async deleteMilestone(id: string): Promise<void> {
      const milestone = this.milestones.find((m) => m.id === id)
      if (!milestone) return
      const taskIds = this.tasks.filter((t) => t.milestoneId === id).map((t) => t.id)
      await db.transaction('rw', milestonesTable(), tasksTable(), async () => {
        if (taskIds.length) await tasksTable().bulkDelete(taskIds)
        await milestonesTable().delete(id)
      })
      this.tasks = this.tasks.filter((t) => t.milestoneId !== id)
      this.milestones = this.milestones.filter((m) => m.id !== id)
      const remaining = this.milestonesOf(milestone.goalId).map((m) => m.id)
      if (remaining.length) await this.reorderMilestones(milestone.goalId, remaining)
    },

    // ---------- 任务 ----------

    async addTask(
      milestoneId: string,
      input: { title: string; detail?: string; estimate?: 'S' | 'M' | 'L' },
      parentId?: string,
    ): Promise<Task> {
      const siblings = parentId ? this.childTasksOf(parentId) : this.rootTasksOf(milestoneId)
      const task = newTask({ milestoneId, parentId, ...input, order: siblings.length })
      await tasksTable().put(task)
      this.tasks = [...this.tasks, task]
      return task
    },

    async updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'milestoneId'>>): Promise<void> {
      const current = this.tasks.find((t) => t.id === id)
      if (!current) throw new Error('任务不存在')
      const next: Task = { ...current, ...patch }
      await tasksTable().put(plain(next))
      this.tasks = this.tasks.map((t) => (t.id === id ? next : t))
    },

    async setTaskStatus(id: string, status: TaskStatus): Promise<void> {
      await this.updateTask(id, { status })
    },

    /** 物理删除任务及其全部子孙，再把同级任务重新编号 */
    async deleteTask(id: string): Promise<void> {
      const task = this.tasks.find((t) => t.id === id)
      if (!task) return
      const ids = this.taskDescendantIds(id)
      await tasksTable().bulkDelete(ids)
      this.tasks = this.tasks.filter((t) => !ids.includes(t.id))
      await this.renumberSiblings(task.milestoneId, task.parentId)
    },

    /** 同一父级下的任务按 index 重新编号 */
    async renumberSiblings(milestoneId: string, parentId?: string): Promise<void> {
      const list = this.tasks
        .filter((t) => t.milestoneId === milestoneId && (t.parentId ?? '') === (parentId ?? ''))
        .sort((a, b) => a.order - b.order)
      const updates = list
        .map((task, index) => (task.order === index ? null : { ...task, order: index }))
        .filter((task): task is Task => task !== null)
      if (updates.length === 0) return
      await tasksTable().bulkPut(plain(updates))
      const map = new Map(updates.map((task) => [task.id, task]))
      this.tasks = this.tasks.map((task) => map.get(task.id) ?? task)
    },

    async reorderTasks(milestoneId: string, orderedIds: string[]): Promise<void> {
      const updates: Task[] = []
      orderedIds.forEach((id, index) => {
        const current = this.tasks.find((t) => t.id === id && t.milestoneId === milestoneId)
        if (current) updates.push({ ...current, order: index })
      })
      await db.transaction('rw', tasksTable(), async () => {
        await tasksTable().bulkPut(plain(updates))
      })
      const map = new Map(updates.map((task) => [task.id, task]))
      this.tasks = this.tasks.map((task) => map.get(task.id) ?? task)
    },

    /** 缩进：挂到上一个同级任务下面，成为它的最后一个子任务 */
    async indentTask(id: string): Promise<void> {
      const task = this.tasks.find((t) => t.id === id)
      if (!task) throw new Error('任务不存在')
      const siblings = this.tasks
        .filter((t) => t.milestoneId === task.milestoneId && (t.parentId ?? '') === (task.parentId ?? ''))
        .sort((a, b) => a.order - b.order)
      const index = siblings.findIndex((t) => t.id === id)
      if (index <= 0) throw new Error('上面没有同级任务，无法缩进')
      const prev = siblings[index - 1]!
      if (this.taskDepth(prev.id) >= MAX_TASK_DEPTH) {
        throw new Error(`最多支持 ${MAX_TASK_DEPTH} 层任务`)
      }
      const childCount = this.childTasksOf(prev.id).length
      await this.updateTask(id, { parentId: prev.id, order: childCount })
      await this.renumberSiblings(task.milestoneId, task.parentId)
    },

    /** 提升：变成父任务的下一个同级；本来就在最外层则报错 */
    async outdentTask(id: string): Promise<void> {
      const task = this.tasks.find((t) => t.id === id)
      if (!task) throw new Error('任务不存在')
      if (!task.parentId) throw new Error('已经在最外层')
      const parent = this.tasks.find((t) => t.id === task.parentId)
      if (!parent) {
        await this.updateTask(id, { parentId: undefined })
        return
      }
      const parentSiblings = this.tasks
        .filter((t) => t.milestoneId === parent.milestoneId && (t.parentId ?? '') === (parent.parentId ?? ''))
        .sort((a, b) => a.order - b.order)
      const insertAt = parentSiblings.findIndex((t) => t.id === parent.id) + 1
      const ordered = parentSiblings.map((t) => t.id)
      ordered.splice(insertAt, 0, task.id)
      const updates: Task[] = []
      ordered.forEach((tid, index) => {
        const current = tid === task.id ? task : this.tasks.find((t) => t.id === tid)
        if (!current) return
        updates.push({ ...current, parentId: parent.parentId, order: index })
      })
      await tasksTable().bulkPut(plain(updates))
      const map = new Map(updates.map((t) => [t.id, t]))
      this.tasks = this.tasks.map((t) => map.get(t.id) ?? t)
      await this.renumberSiblings(task.milestoneId, task.parentId)
    },

    /** 同级内上下移动（-1 上移，+1 下移） */
    async moveSibling(id: string, delta: -1 | 1): Promise<void> {
      const task = this.tasks.find((t) => t.id === id)
      if (!task) throw new Error('任务不存在')
      const ids = this.tasks
        .filter((t) => t.milestoneId === task.milestoneId && (t.parentId ?? '') === (task.parentId ?? ''))
        .sort((a, b) => a.order - b.order)
        .map((t) => t.id)
      const from = ids.indexOf(id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= ids.length) return
      const [moved] = ids.splice(from, 1)
      if (moved === undefined) return
      ids.splice(to, 0, moved)
      const updates = ids
        .map((tid, index) => {
          const current = this.tasks.find((t) => t.id === tid)
          return current ? { ...current, order: index } : null
        })
        .filter((t): t is Task => t !== null)
      await tasksTable().bulkPut(plain(updates))
      const map = new Map(updates.map((t) => [t.id, t]))
      this.tasks = this.tasks.map((t) => map.get(t.id) ?? t)
    },

    // ---------- 周期 ----------

    async createCycle(goalId: string, input: { label: string; startDate: string; endDate: string; focus?: string }): Promise<Cycle> {
      const cycle = newCycle({ goalId, ...input })
      await cyclesTable().put(cycle)
      this.cycles = [...this.cycles, cycle]
      return cycle
    },

    async updateCycle(id: string, patch: Partial<Omit<Cycle, 'id' | 'goalId'>>): Promise<void> {
      const current = this.cycles.find((c) => c.id === id)
      if (!current) throw new Error('周期不存在')
      const next: Cycle = { ...current, ...patch }
      await cyclesTable().put(next)
      this.cycles = this.cycles.map((c) => (c.id === id ? next : c))
    },

    async assignTaskToCycle(taskId: string, cycleId: string): Promise<void> {
      await this.updateTask(taskId, { cycleId })
    },

    async removeTaskFromCycle(taskId: string): Promise<void> {
      const current = this.tasks.find((t) => t.id === taskId)
      if (!current) return
      const next: Task = { ...current, cycleId: undefined }
      await tasksTable().put(plain(next))
      this.tasks = this.tasks.map((t) => (t.id === taskId ? next : t))
    },

    // ---------- 看板 ----------

    async createRole(input: {
      name: string
      tier?: RoleTier
      charter?: string
      promptId?: string
      promptTitle?: string
      maxDoing?: number
    }): Promise<BoardRole> {
      const role = newBoardRole(input)
      await rolesTable().put(role)
      this.roles = [...this.roles, role]
      return role
    },

    async updateRole(id: string, patch: Partial<Omit<BoardRole, 'id' | 'createdAt'>>): Promise<void> {
      const current = this.roles.find((role) => role.id === id)
      if (!current) throw new Error('角色不存在')
      const next = boardRoleSchema.parse({ ...current, ...patch, updatedAt: isoNow() })
      await rolesTable().put(plain(next))
      this.roles = this.roles.map((role) => (role.id === id ? next : role))
    },

    async deactivateRole(id: string): Promise<void> {
      await this.updateRole(id, { active: false })
    },

    /** 手动/确认后分配人格：只改 roleId，不动 status */
    async assignRole(taskId: string, roleId: string | null): Promise<void> {
      await this.updateTask(taskId, { roleId: roleId ?? undefined })
    },

    /** 看板换列：更新状态并重排在同一列中的顺序 */
    async moveTaskOnBoard(
      taskId: string,
      status: TaskStatus,
      orderedIdsInColumn: string[],
    ): Promise<void> {
      const current = this.tasks.find((t) => t.id === taskId)
      if (!current) throw new Error('任务不存在')
      const updates: Task[] = []
      orderedIdsInColumn.forEach((id, index) => {
        const task = this.tasks.find((t) => t.id === id)
        if (!task) return
        updates.push({
          ...task,
          status: id === taskId ? status : task.status,
          boardOrder: index,
        })
      })
      // 目标列原有的任务也要补 boardOrder，避免与新任务排序键冲突
      const movedIds = new Set(orderedIdsInColumn)
      for (const task of this.tasks) {
        if (task.status === status && !movedIds.has(task.id)) {
          updates.push({ ...task, boardOrder: orderedIdsInColumn.length + task.order })
        }
      }
      await db.transaction('rw', tasksTable(), async () => {
        await tasksTable().bulkPut(plain(updates))
      })
      const map = new Map(updates.map((task) => [task.id, task]))
      this.tasks = this.tasks.map((task) => map.get(task.id) ?? task)
    },

    /** 主理人草案应用：单事务只写 roleId / boardPriority，永不改 status */
    async applyDispatch(assignments: Array<{ taskId: string; roleId: string; priority?: 1 | 2 | 3 }>): Promise<void> {
      const updates: Task[] = []
      for (const item of assignments) {
        const task = this.tasks.find((t) => t.id === item.taskId)
        if (!task) continue
        updates.push({
          ...task,
          roleId: item.roleId,
          boardPriority: item.priority ?? task.boardPriority ?? 2,
        })
      }
      if (updates.length === 0) return
      await db.transaction('rw', tasksTable(), async () => {
        await tasksTable().bulkPut(plain(updates))
      })
      const map = new Map(updates.map((task) => [task.id, task]))
      this.tasks = this.tasks.map((task) => map.get(task.id) ?? task)
    },
  },
})
