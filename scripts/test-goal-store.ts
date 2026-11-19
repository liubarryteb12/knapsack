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

  console.log('persistence')

  setActivePinia(createPinia())
  const reloaded = useGoalsStore()
  await reloaded.loadAll()
  check('刷新后数据仍在', reloaded.goals.length === 1 && reloaded.tasks.length === 2)

  console.log('cascade delete')

  await reloaded.deleteGoal(goal.id)
  check('删除目标级联清理四层', reloaded.goals.length === 0 && reloaded.milestones.length === 0 && reloaded.tasks.length === 0 && reloaded.cycles.length === 0)

  console.log(`\nfailed=${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
