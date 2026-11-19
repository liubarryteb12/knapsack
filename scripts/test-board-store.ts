/**
 * mod-goals 看板 store 测试：boardTasksByStatus 过滤与排序、角色 CRUD、看板换列事务。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-board-store.ts
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useGoalsStore } from '../src/mods/mod-goals/store'
import { newGoal, newMilestone, newTask, type TaskStatus } from '../src/mods/mod-goals/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

setActivePinia(createPinia())
const store = useGoalsStore()

// ---------- 准备数据 ----------

const activeGoal = newGoal({ title: '写作目标', startDate: '2026-11-20' })
const draftGoal = newGoal({ title: '草稿目标', startDate: '2026-11-20' })
await store.createGoal({ title: activeGoal.title, startDate: activeGoal.startDate })
await store.createGoal({ title: draftGoal.title, startDate: draftGoal.startDate })
// 直接改状态模拟：第二个目标是 draft
const draftId = store.goals.find((g) => g.title === '草稿目标')!.id
await store.updateGoal(draftId, { status: 'draft' })
const activeId = store.goals.find((g) => g.title === '写作目标')!.id
await store.updateGoal(activeId, { status: 'active' })

const msA = await store.addMilestone(activeId, { title: '选题库', acceptance: '20 个选题' })
const msDraft = await store.addMilestone(draftId, { title: '草稿里程碑', acceptance: '验收' })

const taskTodo = await store.addTask(msA.id, { title: '收集选题' })
const taskTodo2 = await store.addTask(msA.id, { title: '整理大纲' })
const taskDoing = await store.addTask(msA.id, { title: '写第一篇' })
const taskDone = await store.addTask(msA.id, { title: '注册账号' })
const taskDraft = await store.addTask(msDraft.id, { title: '草稿目标下的任务' })
await store.updateTask(taskDoing.id, { status: 'doing' })
await store.updateTask(taskDone.id, { status: 'done' })

// ---------- boardTasksByStatus ----------

{
  const todo = store.boardTasksByStatus('todo')
  check('看板过滤：draft 目标任务不上板', !todo.some((t) => t.id === taskDraft.id))
  check('看板过滤：todo 列含 active 目标的 2 个任务', todo.length === 2)
  check('看板列别：done 列 1 个', store.boardTasksByStatus('done').length === 1)
  check('看板列别：doing 列 1 个', store.boardTasksByStatus('doing').length === 1)
}

// ---------- 角色 CRUD ----------

{
  const role = await store.createRole({ name: '研究助手', charter: '负责外部检索' })
  check('创建角色：默认启用', role.active && store.activeRoles.length === 1)
  await store.updateRole(role.id, { tier: 'helper', maxDoing: 3 })
  check('更新角色：tier/maxDoing 生效', store.roleById(role.id)?.tier === 'helper' && store.roleById(role.id)?.maxDoing === 3)
  await store.deactivateRole(role.id)
  check('停用角色：activeRoles 为空但记录保留', store.activeRoles.length === 0 && store.roles.length === 1)

  const role2 = await store.createRole({ name: '写作者' })
  await store.assignRole(taskTodo.id, role2.id)
  check('手动分配人格：roleId 落库', store.tasks.find((t) => t.id === taskTodo.id)?.roleId === role2.id)
  check('doingCount：doing 无人格时不计', Object.keys(store.doingCountByRole).length === 0)
  await store.assignRole(taskTodo.id, null)
  check('取消分配：roleId 清空', store.tasks.find((t) => t.id === taskTodo.id)?.roleId === undefined)
}

// ---------- 看板换列 ----------

{
  await store.moveTaskOnBoard(taskTodo.id, 'doing', [taskDoing.id, taskTodo.id])
  const moved = store.tasks.find((t) => t.id === taskTodo.id)
  check('换列：todo → doing', moved?.status === 'doing')
  check('换列：boardOrder 写入', moved?.boardOrder === 1)
  const anchor = store.tasks.find((t) => t.id === taskDoing.id)
  check('换列：原列任务补 boardOrder', anchor?.boardOrder === 0)

  // 重排同一列
  await store.moveTaskOnBoard(taskTodo.id, 'doing', [taskTodo.id, taskDoing.id])
  check('列内重排：boardOrder 更新为 0', store.tasks.find((t) => t.id === taskTodo.id)?.boardOrder === 0)
  check('列内重排：状态保持 doing', store.tasks.find((t) => t.id === taskTodo.id)?.status === 'doing')

  // 换回 todo
  await store.moveTaskOnBoard(taskTodo.id, 'todo', [taskTodo2.id, taskTodo.id])
  check('换列回 todo：状态正确', store.tasks.find((t) => t.id === taskTodo.id)?.status === 'todo')
}

console.log(failed === 0 ? '\nboard-store: all passed' : `\nboard-store: ${failed} failed`)
if (failed > 0) process.exit(1)
