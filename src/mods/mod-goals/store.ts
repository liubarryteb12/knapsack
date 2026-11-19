import { defineStore } from 'pinia'
import { db } from '../../db'
import { todayStr } from '../../utils/date'
import {
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
      return [...state.goals].sort(
        (a, b) =>
          rank[a.status] - rank[b.status] ||
          a.priority - b.priority ||
          (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31'),
      )
    },
    goalById(state) {
      return (id: string): Goal | undefined => state.goals.find((goal) => goal.id === id)
    },
    milestonesOf(state) {
      return (goalId: string): Milestone[] =>
        state.milestones.filter((m) => m.goalId === goalId).sort((a, b) => a.order - b.order)
    },
    tasksOf(state) {
      return (milestoneId: string): Task[] =>
        state.tasks.filter((t) => t.milestoneId === milestoneId).sort((a, b) => a.order - b.order)
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
      await goalsTable().put(goal)
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

    // ---------- 任务 ----------

    async addTask(milestoneId: string, input: { title: string; detail?: string; estimate?: 'S' | 'M' | 'L' }): Promise<Task> {
      const order = this.tasksOf(milestoneId).length
      const task = newTask({ milestoneId, ...input, order })
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
