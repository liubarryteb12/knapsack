/**
 * 四个只读工具的投影逻辑（纯函数，便于测试）。
 * 数据只来自 workspace-snapshot.v1 文件，不接触 App 的 IndexedDB。
 */

export function buildGoalTree(snapshot) {
  const milestonesByGoal = new Map()
  for (const milestone of snapshot.milestones) {
    const list = milestonesByGoal.get(milestone.goalId) ?? []
    list.push(milestone)
    milestonesByGoal.set(milestone.goalId, list)
  }
  const tasksByMilestone = new Map()
  for (const task of snapshot.tasks) {
    const list = tasksByMilestone.get(task.milestoneId) ?? []
    list.push(task)
    tasksByMilestone.set(task.milestoneId, list)
  }
  const cyclesByGoal = new Map()
  for (const cycle of snapshot.cycles) {
    const list = cyclesByGoal.get(cycle.goalId) ?? []
    list.push(cycle)
    cyclesByGoal.set(cycle.goalId, list)
  }

  const taskView = (task) => ({
    id: task.id,
    title: task.title,
    detail: task.detail || undefined,
    status: task.status,
    estimate: task.estimate,
    dueDate: task.dueDate,
    cycleId: task.cycleId,
    roleId: task.roleId,
    boardOrder: task.boardOrder,
    boardPriority: task.boardPriority,
  })

  return snapshot.goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    why: goal.why || undefined,
    successCriteria: goal.successCriteria || undefined,
    horizon: goal.horizon,
    startDate: goal.startDate,
    targetDate: goal.targetDate,
    status: goal.status,
    priority: goal.priority,
    milestones: [...(milestonesByGoal.get(goal.id) ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        acceptance: milestone.acceptance || undefined,
        targetDate: milestone.targetDate,
        status: milestone.status,
        tasks: [...(tasksByMilestone.get(milestone.id) ?? [])]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(taskView),
      })),
    cycles: [...(cyclesByGoal.get(goal.id) ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)),
  }))
}

export function buildBoard(snapshot) {
  const activeGoalIds = new Set(snapshot.goals.filter((goal) => goal.status === 'active').map((goal) => goal.id))
  const activeMilestones = snapshot.milestones.filter((milestone) => activeGoalIds.has(milestone.goalId))
  const milestoneById = new Map(activeMilestones.map((milestone) => [milestone.id, milestone]))
  const goalById = new Map(snapshot.goals.map((goal) => [goal.id, goal]))
  const roleById = new Map(snapshot.roles.map((role) => [role.id, role]))

  const boardTasks = snapshot.tasks
    .filter((task) => milestoneById.has(task.milestoneId) && task.status !== 'dropped')
    .sort(
      (a, b) =>
        (a.boardOrder ?? a.order ?? 0) - (b.boardOrder ?? b.order ?? 0) ||
        (a.boardPriority ?? 2) - (b.boardPriority ?? 2),
    )
    .map((task) => {
      const milestone = milestoneById.get(task.milestoneId)
      const goal = goalById.get(milestone.goalId)
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        estimate: task.estimate,
        dueDate: task.dueDate,
        goalTitle: goal?.title,
        milestoneTitle: milestone.title,
        roleId: task.roleId,
        roleName: task.roleId ? roleById.get(task.roleId)?.name : undefined,
        boardPriority: task.boardPriority,
        boardOrder: task.boardOrder,
      }
    })

  const columns = { todo: [], doing: [], done: [] }
  for (const task of boardTasks) {
    if (task.status === 'todo' || task.status === 'doing' || task.status === 'done') {
      columns[task.status].push(task)
    }
  }

  const doingCountByRole = {}
  for (const task of boardTasks) {
    if (task.status === 'doing' && task.roleId) {
      doingCountByRole[task.roleId] = (doingCountByRole[task.roleId] ?? 0) + 1
    }
  }

  const roles = snapshot.roles.map((role) => ({
    id: role.id,
    name: role.name,
    tier: role.tier,
    active: role.active !== false,
    maxDoing: role.maxDoing ?? 2,
    doingCount: doingCountByRole[role.id] ?? 0,
  }))

  return {
    exportedAt: snapshot.createdAt,
    columns,
    roles,
    unassignedTodoIds: columns.todo.filter((task) => !task.roleId).map((task) => task.id),
    activeGoals: [...activeGoalIds].map((id) => ({ id, title: goalById.get(id)?.title })),
  }
}

export function buildRoles(snapshot) {
  const promptById = new Map(snapshot.prompts.map((prompt) => [prompt.id, prompt]))
  const doingCountByRole = {}
  for (const task of snapshot.tasks) {
    if (task.status === 'doing' && task.roleId) {
      doingCountByRole[task.roleId] = (doingCountByRole[task.roleId] ?? 0) + 1
    }
  }
  return snapshot.roles.map((role) => {
    const prompt = role.promptId ? promptById.get(role.promptId) : undefined
    return {
      id: role.id,
      name: role.name,
      tier: role.tier,
      charter: role.charter || undefined,
      active: role.active !== false,
      maxDoing: role.maxDoing ?? 2,
      doingCount: doingCountByRole[role.id] ?? 0,
      promptId: role.promptId,
      promptTitle: role.promptTitle ?? prompt?.title,
      promptAvailable: role.promptId ? Boolean(prompt) : undefined,
      promptSummary: prompt?.systemRole ? prompt.systemRole.slice(0, 200) : undefined,
    }
  })
}

export function buildPrompts(snapshot, { promptId, includeBody = false } = {}) {
  if (promptId) {
    const prompt = snapshot.prompts.find((item) => item.id === promptId)
    if (!prompt) return { found: false, promptId, message: `提示词不存在：${promptId}` }
    return { found: true, prompt: promptView(prompt, true) }
  }
  return {
    total: snapshot.prompts.length,
    prompts: snapshot.prompts.map((prompt) => promptView(prompt, includeBody)),
  }
}

function promptView(prompt, withBody) {
  return {
    id: prompt.id,
    title: prompt.title,
    outputFormat: prompt.outputFormat,
    facets: prompt.facets,
    systemRole: withBody ? prompt.systemRole : undefined,
    systemRoleSummary: prompt.systemRole ? prompt.systemRole.slice(0, 120) : undefined,
    templateBody: withBody ? prompt.templateBody : undefined,
  }
}
