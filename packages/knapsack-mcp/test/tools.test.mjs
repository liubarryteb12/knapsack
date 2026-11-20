/**
 * knapsack-mcp 单元测试：fixture（由 Knapsack 回归测试 scripts/test-workspace-snapshot.ts 生成）
 * 驱动的四个工具投影 + 空态/损坏态。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadSnapshot, stalenessNote } from '../src/loader.js'
import { buildBoard, buildGoalTree, buildPrompts, buildRoles } from '../src/tools.js'

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'snapshot.example.json')

async function fixture() {
  return JSON.parse(await readFile(FIXTURE, 'utf8'))
}

test('fixture 可被读取端 schema 接受', async () => {
  const loaded = await loadSnapshot(FIXTURE)
  assert.equal(loaded.ok, true, loaded.message)
  assert.equal(loaded.snapshot.format, 'workspace-snapshot.v1')
})

test('get_goals：目标树含里程碑/任务/周期，任务带看板字段', async () => {
  const snapshot = await fixture()
  const tree = buildGoalTree(snapshot)
  assert.equal(tree.length, snapshot.goals.length)
  const goal = tree.find((item) => item.milestones.length > 0)
  assert.ok(goal, '至少一个目标有里程碑')
  const task = goal.milestones.flatMap((m) => m.tasks).find((t) => t.roleId)
  assert.ok(task, '至少一个任务有 roleId')
  assert.equal(typeof task.boardPriority, 'number')
})

test('get_board：三列齐全，容量占用按 doing 计数', async () => {
  const snapshot = await fixture()
  const board = buildBoard(snapshot)
  assert.deepEqual(Object.keys(board.columns), ['todo', 'doing', 'done'])
  const doingTask = board.columns.doing[0]
  if (doingTask?.roleId) {
    const role = board.roles.find((item) => item.id === doingTask.roleId)
    assert.ok(role.doingCount >= 1)
  }
})

test('get_roles：提示词可用性标记', async () => {
  const snapshot = await fixture()
  const roles = buildRoles(snapshot)
  assert.equal(roles.length, snapshot.roles.length)
  for (const role of roles) {
    if (role.promptId) assert.equal(typeof role.promptAvailable, 'boolean')
  }
})

test('get_prompts：目录默认不带正文，单条可取正文', async () => {
  const snapshot = await fixture()
  const catalog = buildPrompts(snapshot)
  assert.equal(catalog.total, snapshot.prompts.length)
  for (const item of catalog.prompts) {
    assert.equal(item.templateBody, undefined)
  }
  if (snapshot.prompts[0]) {
    const one = buildPrompts(snapshot, { promptId: snapshot.prompts[0].id })
    assert.equal(one.found, true)
    assert.equal(typeof one.prompt.templateBody, 'string')
  }
})

test('空态：文件不存在返回引导文案，不抛错', async () => {
  const loaded = await loadSnapshot(path.join(import.meta.dirname, 'no-such-file.json'))
  assert.equal(loaded.ok, false)
  assert.match(loaded.message, /导出快照/)
})

test('损坏态：非法 JSON 返回提示', async () => {
  const { writeFile, mkdtemp } = await import('node:fs/promises')
  const os = await import('node:os')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'knapsack-mcp-'))
  const file = path.join(dir, 'broken.json')
  await writeFile(file, '{ not json')
  const loaded = await loadSnapshot(file)
  assert.equal(loaded.ok, false)
  assert.match(loaded.message, /不是合法 JSON/)
})

test('过期快照给出提示', () => {
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString()
  assert.match(stalenessNote(old), /10 天未更新/)
  assert.equal(stalenessNote(new Date().toISOString()), undefined)
})
