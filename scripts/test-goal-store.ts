/**
 * mod-goals 数据层回归：想法晋级、四层 CRUD、进度派生、周期分配与级联删除。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-goal-store.ts
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../src/db'
import { useGoalsStore } from '../src/mods/mod-goals/store'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function main() {
  await db.delete()
  await db.open()
  setActivePinia(createPinia())

  const store = useGoalsStore()
  await store.loadAll()
  check('空库可加载', store.loaded && store.goals.length === 0)

  console.log('ideas')

  const idea = await store.createIdea({ title: '建立写作习惯', raw: '想每周写一篇。', tags: ['写作'] })
  check('想法入库', store.ideas.length === 1 && idea.status === 'raw')

  await store.updateIdea(idea.id, { status: 'clarified' })
  check('想法状态可更新', store.ideas[0]?.status === 'clarified')

  const goal = await store.promoteIdea(idea.id)
  check('晋级生成目标', store.goals.length === 1 && goal.sourceIdeaId === idea.id)
  check('想法回填 goalId 并置为 promoted', store.ideas[0]?.status === 'promoted' && store.ideas[0]?.goalId === goal.id)

  console.log('four layers')

  const milestone = await store.addMilestone(goal.id, { title: '建立选题库', acceptance: '至少 20 个选题' })
  const second = await store.addMilestone(goal.id, { title: '完成初稿', acceptance: '有可发布初稿' })
  check('里程碑按顺序排列', store.milestonesOf(goal.id).map((m) => m.id).join(',') === `${milestone.id},${second.id}`)

  const task = await store.addTask(milestone.id, { title: '收集 20 个读者问题' })
  check('任务挂在里程碑下', store.tasksOf(milestone.id).length === 1)
  check('未完成任务进度为 0', store.goalProgress(goal.id) === 0)

  await store.setTaskStatus(task.id, 'done')
  check('完成任务后进度为 1', store.goalProgress(goal.id) === 1)

  const cycle = await store.createCycle(goal.id, {
    label: '2026-11 第 4 周',
    startDate: '2026-11-23',
    endDate: '2026-11-29',
    focus: '搭骨架',
  })
  check('周期入库', store.cyclesOf(goal.id).length === 1)

  const task2 = await store.addTask(second.id, { title: '写第一篇初稿' })
  await store.assignTaskToCycle(task2.id, cycle.id)
  check('任务可排入周期', store.tasks.find((t) => t.id === task2.id)?.cycleId === cycle.id)
  check('未排期任务只剩一条', store.unassignedTasks(goal.id).length === 1)

  await store.removeTaskFromCycle(task2.id)
  check('任务可撤回周期', store.tasks.find((t) => t.id === task2.id)?.cycleId === undefined)

  console.log('edit, reorder & delete')

  await store.reorderMilestones(goal.id, [second.id, milestone.id])
  check(
    '里程碑可上下重排',
    store.milestonesOf(goal.id).map((m) => m.id).join(',') === `${second.id},${milestone.id}`,
  )

  const extraTask = await store.addTask(milestone.id, { title: '临时任务' })
  const milestoneTasks = store.tasksOf(milestone.id)
  check('新任务追加到末尾', milestoneTasks[milestoneTasks.length - 1]?.id === extraTask.id)

  await store.reorderTasks(milestone.id, [extraTask.id, task.id])
  check(
    '任务可上下重排',
    store.tasksOf(milestone.id).map((t) => t.id).join(',') === `${extraTask.id},${task.id}`,
  )

  await store.deleteTask(extraTask.id)
  check(
    '任务可删除并重排',
    store.tasksOf(milestone.id).length === 1 && store.tasksOf(milestone.id)[0]?.order === 0,
  )

  const tempMilestone = await store.addMilestone(goal.id, { title: '临时里程碑', acceptance: '验证删除' })
  await store.addTask(tempMilestone.id, { title: '临时任务 2' })
  await store.deleteMilestone(tempMilestone.id)
  check(
    '里程碑可删除并级联任务',
    store.milestonesOf(goal.id).length === 2 &&
      store.tasks.filter((t) => t.milestoneId === tempMilestone.id).length === 0,
  )

  console.log('task hierarchy')

  const root1 = await store.addTask(milestone.id, { title: '根一' })
  const root2 = await store.addTask(milestone.id, { title: '根二' })
  await store.indentTask(root2.id)
  check('缩进后挂到上一个同级下', store.taskById(root2.id)?.parentId === root1.id)
  check('缩进后不再是一级任务', store.rootTasksOf(milestone.id).length === 2)

  const childA = await store.addTask(milestone.id, { title: '子一' }, root1.id)
  const childB = await store.addTask(milestone.id, { title: '子二' }, root1.id)
  check('可直接添加子任务', store.childTasksOf(root1.id).length === 3)
  await store.outdentTask(childB.id)
  check('提升后回到父级的同级', store.taskById(childB.id)?.parentId === undefined)
  await store.moveSibling(childB.id, -1)
  check('同级上移生效', store.rootTasksOf(milestone.id)[1]?.id === childB.id)

  let indentBlocked = false
  try {
    await store.indentTask(store.rootTasksOf(milestone.id)[0]!.id)
  } catch {
    indentBlocked = true
  }
  check('第一个同级不能缩进', indentBlocked)

  check('深度计算正确', store.taskDepth(childA.id) === 2 && store.taskDepth(root1.id) === 1)
  check('子孙 id 收集完整', store.taskDescendantIds(root1.id).sort().join(',') === [root1.id, root2.id, childA.id].sort().join(','))

  await store.deleteTask(root1.id)
  check(
    '删除父任务级联子孙',
    !store.taskById(root1.id) && !store.taskById(childA.id) && !store.taskById(root2.id),
  )
  check('删除后同级序号连续', store.rootTasksOf(milestone.id).every((t, i) => t.order === i))

  console.log('goal ordering')

  const goalB = await store.createGoal({ title: '第二个目标', priority: 3 })
  const goalC = await store.createGoal({ title: '第三个目标', priority: 1 })
  check('未拖序时按优先级自动排序', store.goalsSorted[0]?.id === goalC.id)

  await store.reorderGoals([goalB.id, goal.id, goalC.id])
  check(
    '目标可手动重排',
    store.goalsSorted.map((g) => g.id).join(',') === `${goalB.id},${goal.id},${goalC.id}`,
  )
  check('手动序落在 goalOrder', store.goalById(goalB.id)?.goalOrder === 0)

  const goalD = await store.createGoal({ title: '追加目标' })
  check('手动排序后新目标追加到末尾', store.goalsSorted[store.goalsSorted.length - 1]?.id === goalD.id)

  console.log('persistence')

  setActivePinia(createPinia())
  const reloaded = useGoalsStore()
  await reloaded.loadAll()
  check(
    '刷新后数据仍在',
    reloaded.goals.length === 4 && reloaded.tasks.length === store.tasks.length,
  )

  console.log('cascade delete')

  for (const item of [goal, goalB, goalC, goalD]) await reloaded.deleteGoal(item.id)
  check('删除目标级联清理四层', reloaded.goals.length === 0 && reloaded.milestones.length === 0 && reloaded.tasks.length === 0 && reloaded.cycles.length === 0)

  console.log(`\nfailed=${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
