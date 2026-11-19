/**
 * mod-goals 看板契约测试：BoardRole、Task 看板扩展字段、分派草案校验。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-board-schema.ts
 */
import {
  boardRoleSchema,
  dispatchDraftSchema,
  newBoardRole,
  newTask,
  taskSchema,
  validateDispatch,
  DispatchError,
  type DispatchDraft,
} from '../src/mods/mod-goals/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function expectFail(name: string, fn: () => unknown, keyword?: string) {
  try {
    fn()
    check(name, false)
  } catch (error) {
    if (error instanceof DispatchError) throw error
    const message = error instanceof Error ? error.message : String(error)
    check(name, keyword ? message.includes(keyword) : true)
  }
}

function draftWith(assignments: Array<Record<string, unknown>>): unknown {
  return {
    createdAt: '2026-11-20T08:00:00.000Z',
    model: 'deepseek-chat',
    assignments,
    unassigned: [],
    notes: '',
  }
}

// ---------- BoardRole ----------

{
  const role = newBoardRole({ name: '研究助手' })
  check('角色工厂：默认 specialist / maxDoing 2 / active', role.tier === 'specialist' && role.maxDoing === 2 && role.active)
  check('角色工厂：无提示词引用', role.promptId === undefined)

  const lead = newBoardRole({ name: '主责', tier: 'lead', promptId: 'p1', promptTitle: '研究员人格' })
  check('角色工厂：引用提示词', lead.promptId === 'p1' && lead.promptTitle === '研究员人格')

  expectFail('空名称被拒', () => boardRoleSchema.parse({ ...role, name: '  ' }))
  expectFail('非法 tier 被拒', () => boardRoleSchema.parse({ ...role, tier: 'boss' }))
  expectFail('maxDoing 超上限被拒', () => boardRoleSchema.parse({ ...role, maxDoing: 10 }))
  expectFail('charter 超长被拒', () => boardRoleSchema.parse({ ...role, charter: 'a'.repeat(501) }))
}

// ---------- Task 看板扩展（向后兼容） ----------

{
  const task = newTask({ milestoneId: 'ms1', title: '写一篇文章' })
  check('旧路径：新任务不带看板字段', task.roleId === undefined && task.boardOrder === undefined)

  const legacy = {
    id: 't-legacy',
    milestoneId: 'ms1',
    title: '旧数据任务',
    detail: '',
    estimate: 'M',
    status: 'todo',
    order: 0,
  }
  const parsed = taskSchema.parse(legacy)
  check('旧数据（无 roleId）通过校验且字段为 undefined', parsed.roleId === undefined)

  const assigned = taskSchema.parse({ ...legacy, roleId: 'role-a', boardOrder: 3, boardPriority: 1 })
  check('带看板字段的任务通过校验', assigned.roleId === 'role-a' && assigned.boardOrder === 3 && assigned.boardPriority === 1)

  expectFail('空 roleId 被拒', () => taskSchema.parse({ ...legacy, roleId: '' }))
  expectFail('负 boardOrder 被拒', () => taskSchema.parse({ ...legacy, boardOrder: -1 }))
}

// ---------- 分派草案 schema ----------

{
  const parsed = dispatchDraftSchema.parse(draftWith([
    { taskId: 't1', roleId: 'r1', priority: 1, traits: ['检索'], reason: '需要外部信息' },
  ]))
  check('草案解析：assignments 保留', parsed.assignments.length === 1)

  const defaulted = dispatchDraftSchema.parse(draftWith([{ taskId: 't1', roleId: 'r1' }]))
  check('草案解析：traits/reason 默认为空', defaulted.assignments[0]?.traits.length === 0)

  expectFail('createdAt 缺失被拒', () => dispatchDraftSchema.parse({ model: 'm', assignments: [] }))
  expectFail('traits 超过 3 个被拒', () =>
    dispatchDraftSchema.parse(draftWith([{ taskId: 't1', roleId: 'r1', traits: ['a', 'b', 'c', 'd'] }])))
  expectFail('reason 超 40 字被拒', () =>
    dispatchDraftSchema.parse(draftWith([{ taskId: 't1', roleId: 'r1', reason: 'x'.repeat(41) }])))
  expectFail('notes 超 200 字被拒', () => dispatchDraftSchema.parse(draftWith([]) && { ...draftWith([]), notes: 'x'.repeat(201) }))
}

// ---------- validateDispatch ----------

{
  const roles = [
    { id: 'r1', maxDoing: 2 },
    { id: 'r2', maxDoing: 1 },
  ]
  const taskIds = new Set(['t1', 't2', 't3', 't4', 't5'])
  const manual = { t4: 'r2' }

  const draft = dispatchDraftSchema.parse(draftWith([
    { taskId: 't1', roleId: 'r1', reason: 'ok' },
    { taskId: 't9', roleId: 'r1', reason: '未知任务' },
    { taskId: 't2', roleId: 'rX', reason: '未知人格' },
    { taskId: 't3', roleId: 'r1', reason: '正常' },
    { taskId: 't3', roleId: 'r2', reason: '重复任务' },
    { taskId: 't4', roleId: 'r1', reason: '手动分派保护' },
    { taskId: 't5', roleId: 'r2', reason: 'r2 容量 1' },
  ])) as DispatchDraft

  const result = validateDispatch(draft, { taskIds, roles, manualRoleByTask: manual, doingCountByRole: { r2: 1 } })

  check('净化：保留合法建议 3 条', result.clean.assignments.length === 3)
  check('丢弃：未知任务/人格/重复/手动保护共 4 条', result.dropped.length === 4)
  check('冲突：r2 容量超限', result.conflicts.length === 1 && result.conflicts[0]!.includes('r2'))

  const doingDraft = dispatchDraftSchema.parse(draftWith([
    { taskId: 't1', roleId: 'r1' },
    { taskId: 't2', roleId: 'r1' },
    { taskId: 't3', roleId: 'r1' },
  ])) as DispatchDraft
  const doingResult = validateDispatch(doingDraft, {
    taskIds,
    roles,
    doingCountByRole: { r1: 1 },
  })
  check('容量：doing 1 + 建议 3 > maxDoing 2 → 冲突', doingResult.conflicts.length === 1)

  const empty = validateDispatch(dispatchDraftSchema.parse(draftWith([])) as DispatchDraft, {
    taskIds: new Set<string>(),
    roles: [],
  })
  check('空草案：无冲突无丢弃', empty.clean.assignments.length === 0 && empty.dropped.length === 0 && empty.conflicts.length === 0)
}

console.log(failed === 0 ? '\nboard-schema: all passed' : `\nboard-schema: ${failed} failed`)
if (failed > 0) process.exit(1)
