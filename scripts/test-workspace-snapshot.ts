/**
 * workspace-snapshot.v1 契约测试（BOARD_MODULE_SPEC §12，M1）：
 * schema 校验、引用完整性、组装排序、fixture 固化（与 knapsack-mcp 双端共测的 golden 样例）。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-workspace-snapshot.ts
 */
import 'fake-indexeddb/auto'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { CapabilityBus } from '../src/core/capabilityBus'
import {
  WORKSPACE_SNAPSHOT_FORMAT,
  verifySnapshotReferences,
  workspaceSnapshotSchema,
  newBoardRole,
  newCycle,
  newGoal,
  newIdea,
  newMilestone,
  newTask,
  type SnapshotPrompt,
  type WorkspaceSnapshot,
} from '../src/mods/mod-goals/schema'
import { buildWorkspaceSnapshot, readSnapshotTables, type SnapshotTables } from '../src/mods/mod-goals/services/workspaceSnapshot'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

const FIXTURE_DIR = path.join(root(), 'packages', 'knapsack-mcp', 'fixtures')
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'snapshot.example.json')

function root(): string {
  return path.resolve(import.meta.dirname, '..')
}

// ---------- 造一份数据齐全的库 ----------

function seedTables(): SnapshotTables {
  const now = Date.now()
  const goal = newGoal({ title: '写完毕业论文', why: '必须毕业', startDate: '2026-12-01' }, now)
  goal.status = 'active'
  const milestone = newMilestone({ goalId: goal.id, title: '文献综述', acceptance: '综述初稿被导师认可' }, now)
  milestone.status = 'active'
  const role = newBoardRole({ name: '研究助手', charter: '检索文献并整理笔记', maxDoing: 2 }, now)
  const task = newTask({ milestoneId: milestone.id, title: '读 10 篇核心文献', estimate: 'L' }, now)
  task.status = 'doing'
  task.roleId = role.id
  task.boardOrder = 0
  task.boardPriority = 1
  const task2 = newTask({ milestoneId: milestone.id, title: '写综述初稿', estimate: 'L' }, now + 1)
  const cycle = newCycle({ goalId: goal.id, label: '12月冲刺', startDate: '2026-12-01', endDate: '2026-12-31' }, now)
  const idea = newIdea({ title: '先想清楚选题' }, now)
  const prompts: SnapshotPrompt[] = [
    {
      id: 'prompt-1',
      title: '文献综述助手',
      systemRole: '你是文献综述助手',
      templateBody: '帮我整理 {{topic}}',
      outputFormat: 'MARKDOWN',
      facets: { targetTool: ['chat'], domainTheme: ['research'], styleTechnique: ['summary'] },
      updatedAt: now,
    },
  ]
  return {
    ideas: [idea],
    goals: [goal],
    milestones: [milestone],
    tasks: [task, task2],
    cycles: [cycle],
    roles: [role],
  }
}

function fakeBus(prompts: SnapshotPrompt[]): CapabilityBus {
  return { query: async () => [prompts] } as unknown as CapabilityBus
}

async function main() {
  const tables = seedTables()
  void tables

  const seeded = seedTables()
  const built = buildWorkspaceSnapshot(seeded, [
    {
      id: 'prompt-1',
      title: '文献综述助手',
      systemRole: '你是文献综述助手',
      templateBody: '帮我整理 {{topic}}',
      outputFormat: 'MARKDOWN',
      facets: { targetTool: ['chat'], domainTheme: ['research'], styleTechnique: ['summary'] },
      updatedAt: Date.now(),
    },
  ])
  check('format 正确', built.format === WORKSPACE_SNAPSHOT_FORMAT)
  check('schema 校验通过', workspaceSnapshotSchema.safeParse(built).success)
  check('引用完整性 0 问题', verifySnapshotReferences(built).length === 0)
  check('五类实体 + prompts 齐全', built.goals.length === 1 && built.milestones.length === 1 && built.tasks.length === 2 && built.roles.length === 1 && built.prompts.length === 1)
  check('看板字段进入快照', built.tasks.some((task) => task.roleId !== undefined && task.boardPriority === 1))
  check('tasks 按 milestone+order 排序', built.tasks[0]!.title === '读 10 篇核心文献')
  check('prompts 按标题排序', built.prompts.every((p, i, arr) => i === 0 || arr[i - 1]!.title.localeCompare(p.title) <= 0))

  // ---------- 引用校验负例 ----------
  const broken: WorkspaceSnapshot = structuredClone(built)
  broken.tasks[0]!.roleId = 'ghost-role'
  const problems = verifySnapshotReferences(broken)
  check('幽灵 roleId 被检出', problems.some((p) => p.path === 'tasks[0].roleId'))
  const broken2 = structuredClone(built)
  broken2.milestones[0]!.goalId = 'ghost-goal'
  check('幽灵 goalId 被检出', verifySnapshotReferences(broken2).some((p) => p.path.includes('goalId')))

  // ---------- build 阶段就拦引用破坏（用注入桩） ----------
  const inconsistent: SnapshotTables = { ...seedTables(), tasks: [{ ...seedTables().tasks[0]!, milestoneId: 'no-such-milestone' }] }
  let threw = ''
  try {
    buildWorkspaceSnapshot(inconsistent, [])
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error)
  }
  check('组装时引用破坏被拦', threw.includes('引用不完整'))

  // ---------- capability 降级：无 provider 时 prompts 为空 ----------
  const emptyBus = { query: async () => [] } as unknown as CapabilityBus
  const { readPromptProjection } = await import('../src/mods/mod-goals/services/workspaceSnapshot')
  const emptyPrompts = await readPromptProjection(emptyBus)
  check('无提示词库时投影为空数组', emptyPrompts.length === 0)
  const noPromptsSnapshot = buildWorkspaceSnapshot(seedTables(), emptyPrompts)
  check('空 prompts 快照仍过校验', workspaceSnapshotSchema.safeParse(noPromptsSnapshot).success)

  // ---------- readSnapshotTables（fake-indexeddb）----------
  const { db } = await import('../src/db')
  await import('../src/core/bootMods').catch(() => {})
  const seeded2 = seedTables()
  await Promise.all([
    db.table('mod_goals_ideas').bulkPut(seeded2.ideas),
    db.table('mod_goals_goals').bulkPut(seeded2.goals),
    db.table('mod_goals_milestones').bulkPut(seeded2.milestones),
    db.table('mod_goals_tasks').bulkPut(seeded2.tasks),
    db.table('mod_goals_cycles').bulkPut(seeded2.cycles),
    db.table('mod_goals_roles').bulkPut(seeded2.roles),
  ])
  const readBack = await readSnapshotTables(db)
  check('readSnapshotTables 读回六表', readBack.goals.length === 1 && readBack.tasks.length === 2 && readBack.roles.length === 1)

  // ---------- fixture 固化（knapsack-mcp 双端共测的 golden 样例） ----------
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
  const existing = existsSync(FIXTURE_FILE) ? readFileSync(FIXTURE_FILE, 'utf8') : ''
  const serialized = JSON.stringify(built, null, 2) + '\n'
  if (existing !== serialized) {
    writeFileSync(FIXTURE_FILE, serialized)
    console.log(existing ? '  ..  fixture 已更新（契约变更，记得同步 MCP 侧）' : '  ..  fixture 首次生成')
  }
  const roundTrip = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as WorkspaceSnapshot
  check('fixture 反序列化仍过 schema', workspaceSnapshotSchema.safeParse(roundTrip).success)
  check('fixture 引用完整', verifySnapshotReferences(roundTrip).length === 0)

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  if (failed > 0) process.exit(1)
}

void main()
