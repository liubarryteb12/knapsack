/**
 * mod-goals 契约测试：goal-pack.v1 校验、跨实体引用、规模上限与派生进度。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-goal-pack.ts
 */
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import {
  goalCompletionRatio,
  goalPackSchema,
  verifyExternalReferences,
  GoalPackError,
  type GoalPack,
} from '../src/mods/mod-goals/schema'
import {
  buildImportPlan,
  commitImport,
  findPreviousImport,
  loadLocalSnapshot,
  parseGoalPackText,
} from '../src/mods/mod-goals/services/parseGoalPack'

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
    const message = error instanceof Error ? error.message : String(error)
    check(name, keyword ? message.includes(keyword) : true)
  }
}

function ideaOnlyPack(): unknown {
  return {
    format: 'goal-pack.v1',
    schemaVersion: 1,
    source: 'claude-desktop',
    createdAt: '2026-11-19T08:00:00.000Z',
    ideas: [
      {
        externalId: 'idea-writing-habit',
        title: '建立写作习惯',
        raw: '想每周写点东西，但总坚持不下来。',
        status: 'raw',
        tags: ['写作'],
        source: 'claude-desktop',
      },
    ],
  }
}

function fullPack(): unknown {
  return {
    format: 'goal-pack.v1',
    schemaVersion: 1,
    source: 'claude-desktop',
    createdAt: '2026-11-19T08:00:00.000Z',
    assumptions: ['未提供每周可投入时间，按每周 10 小时估算'],
    ideas: [
      {
        externalId: 'idea-weekly-writing',
        title: '每周写一篇',
        raw: '想稳定输出公众号文章。',
        status: 'clarified',
        tags: ['公众号'],
        source: 'claude-desktop',
        goalExternalId: 'goal-weekly-writing',
      },
    ],
    goals: [
      {
        externalId: 'goal-weekly-writing',
        title: '连续 8 周每周产出 1 篇',
        why: '为公众号积累选题',
        successCriteria: '8 周内发布 8 篇，其中至少 3 篇进入平台推荐',
        horizon: 'quarter',
        startDate: '2026-11-24',
        targetDate: '2027-01-18',
        status: 'active',
        priority: 1,
        milestones: [
          {
            externalId: 'ms-topic-bank',
            title: '建立选题库',
            acceptance: '至少有 20 个可写选题',
            targetDate: '2026-12-07',
            status: 'todo',
            order: 0,
            tasks: [
              {
                externalId: 'task-collect-topics',
                title: '收集 20 个读者常见问题',
                detail: '',
                estimate: 'M',
                status: 'todo',
                order: 0,
                cycleExternalId: 'cycle-w1',
              },
            ],
          },
        ],
      },
    ],
    cycles: [
      {
        externalId: 'cycle-w1',
        goalExternalId: 'goal-weekly-writing',
        label: '2026-11 第 4 周',
        startDate: '2026-11-23',
        endDate: '2026-11-29',
        focus: '搭好选题库骨架',
      },
    ],
  }
}

async function main() {
  console.log('goal-pack schema')

  const minimal = goalPackSchema.parse(ideaOnlyPack())
  check('只有想法的最小包可通过', minimal.ideas.length === 1 && minimal.goals.length === 0)

  const full = goalPackSchema.parse(fullPack()) as GoalPack
  check('完整四层包可通过', full.goals[0]?.milestones[0]?.tasks.length === 1)
  check('缺省字段补齐', full.assumptions.length === 1 && full.goals[0]?.status === 'active')

  expectFail('format 错误被拒绝', () => {
    goalPackSchema.parse({ ...(ideaOnlyPack() as object), format: 'goal-pack.v2' })
  }, 'format')

  expectFail('三个集合全空被拒绝', () => {
    const empty = ideaOnlyPack() as Record<string, unknown>
    delete empty.ideas
    goalPackSchema.parse(empty)
  }, '至少需要包含')

  const duplicated = fullPack() as {
    goals: Array<{ milestones: Array<{ tasks: Array<{ externalId: string }> }> }>
  }
  duplicated.goals[0]!.milestones[0]!.tasks[0]!.externalId = 'ms-topic-bank'
  expectFail('externalId 重复被拒绝', () => {
    goalPackSchema.parse(duplicated)
  }, '重复')

  const tooManyMilestones = fullPack() as {
    goals: Array<{ milestones: unknown[] }>
  }
  tooManyMilestones.goals[0]!.milestones = Array.from({ length: 7 }, (_, index) => ({
    externalId: `ms-${index}`,
    title: `里程碑 ${index}`,
    acceptance: '验收',
  }))
  expectFail('超过 6 个里程碑被拒绝', () => {
    goalPackSchema.parse(tooManyMilestones)
  }, '最多 6')

  const tooManyTasks = fullPack() as {
    goals: Array<{ milestones: Array<{ tasks: unknown[] }> }>
  }
  tooManyTasks.goals[0]!.milestones[0]!.tasks = Array.from({ length: 6 }, (_, index) => ({
    externalId: `task-${index}`,
    title: `任务 ${index}`,
  }))
  expectFail('超过 5 个任务被拒绝', () => {
    goalPackSchema.parse(tooManyTasks)
  }, '最多 5')

  const badDate = fullPack() as { goals: Array<{ startDate: string }> }
  badDate.goals[0]!.startDate = '2026-13-01'
  expectFail('非法日期被拒绝', () => {
    goalPackSchema.parse(badDate)
  }, '日期')

  const reversed = fullPack() as { goals: Array<{ startDate: string; targetDate: string }> }
  reversed.goals[0]!.startDate = '2027-02-01'
  reversed.goals[0]!.targetDate = '2027-01-01'
  expectFail('目标结束早于开始被拒绝', () => {
    goalPackSchema.parse(reversed)
  }, '结束日期')

  const badExternalId = fullPack() as { ideas: Array<{ externalId: string }> }
  badExternalId.ideas[0]!.externalId = 'Bad_ID'
  expectFail('非 kebab-case 的 externalId 被拒绝', () => {
    goalPackSchema.parse(badExternalId)
  }, 'kebab-case')

  console.log('cross references')

  const pack = goalPackSchema.parse(fullPack())
  let refError: unknown = null
  try {
    verifyExternalReferences(pack, [])
  } catch (error) {
    refError = error
  }
  check('包内引用可自洽', refError === null)
  check('引用错误使用 GoalPackError', refError === null || refError instanceof GoalPackError)

  const orphanCycle = fullPack() as { goals: unknown[]; ideas: unknown[] }
  orphanCycle.goals = []
  orphanCycle.ideas = []
  expectFail('周期指向不存在的目标被拒绝', () => {
    const parsed = goalPackSchema.parse(orphanCycle)
    verifyExternalReferences(parsed, [])
  }, '不存在的目标')

  const orphanCycleRef = fullPack() as { goals: Array<{ milestones: Array<{ tasks: Array<{ cycleExternalId?: string }> }> }> }
  orphanCycleRef.goals[0]!.milestones[0]!.tasks[0]!.cycleExternalId = 'cycle-missing'
  expectFail('任务指向不存在的周期被拒绝', () => {
    const parsed = goalPackSchema.parse(orphanCycleRef)
    verifyExternalReferences(parsed, [])
  }, '不存在的周期')

  check(
    '本地已有 externalId 可满足跨包引用',
    (() => {
      const partial = {
        ...(ideaOnlyPack() as Record<string, unknown>),
        ideas: [
          {
            externalId: 'idea-follow-up',
            title: '承接已有目标',
            goalExternalId: 'goal-existing',
          },
        ],
      }
      const parsed = goalPackSchema.parse(partial)
      verifyExternalReferences(parsed, ['goal-existing'])
      return true
    })(),
  )

  console.log('derived progress')

  check('没有任务时进度为 null', goalCompletionRatio([{ id: 'm1' }], []) === null)
  check(
    '目标进度按任务完成比例计算',
    goalCompletionRatio(
      [{ id: 'm1' }, { id: 'm2' }],
      [
        { status: 'done', milestoneId: 'm1' },
        { status: 'todo', milestoneId: 'm2' },
        { status: 'todo', milestoneId: 'other' },
      ],
    ) === 0.5,
  )

  console.log('importer')

  await db.delete()
  await db.open()

  const fenced = '```goal-pack\n' + JSON.stringify(fullPack()) + '\n```'
  const parsedFromText = parseGoalPackText(fenced)
  check('可从围栏文本解析导入包', parsedFromText.goals.length === 1)

  const plan1 = await buildImportPlan(parsedFromText, await loadLocalSnapshot())
  check(
    '首次导入全部新建',
    plan1.counts.ideas.create === 1 &&
      plan1.counts.goals.create === 1 &&
      plan1.counts.milestones.create === 1 &&
      plan1.counts.tasks.create === 1 &&
      plan1.counts.cycles.create === 1,
  )
  await commitImport(plan1)
  const previous = await findPreviousImport(plan1.idempotencyKey)
  check('导入记录可查询', previous !== undefined)

  const samePlan = await buildImportPlan(goalPackSchema.parse(fullPack()), await loadLocalSnapshot())
  check('同包幂等键一致', samePlan.idempotencyKey === plan1.idempotencyKey)

  const goalId = plan1.goals[0]!.id
  await db.table('mod_goals_goals').update(goalId, { status: 'active' })

  const plan2 = await buildImportPlan(goalPackSchema.parse(fullPack()), await loadLocalSnapshot())
  check('同包再次导入走更新', plan2.counts.goals.update === 1 && plan2.counts.goals.create === 0)
  check('更新不覆盖本地状态', plan2.goals[0]?.status === 'active')

  const changed = fullPack() as {
    goals: Array<{ title: string; milestones: unknown[] }>
  }
  changed.goals[0]!.title = '连续 8 周每周产出 2 篇'
  const plan3 = await buildImportPlan(goalPackSchema.parse(changed), await loadLocalSnapshot())
  await commitImport(plan3)
  const afterChange = await loadLocalSnapshot()
  check(
    '内容字段更新且状态保留',
    afterChange.goals[0]?.title === '连续 8 周每周产出 2 篇' && afterChange.goals[0]?.status === 'active',
  )

  const trimmed = fullPack() as { goals: Array<{ milestones: unknown[] }> }
  trimmed.goals[0]!.milestones = []
  const plan4 = await buildImportPlan(goalPackSchema.parse(trimmed), await loadLocalSnapshot())
  check('未包含的里程碑与任务被计数', plan4.missing.milestones === 1 && plan4.missing.tasks === 1)
  await commitImport(plan4)
  const finalLocal = await loadLocalSnapshot()
  check('导入不删除本地已有项', finalLocal.milestones.length === 1 && finalLocal.tasks.length === 1)

  console.log(`\nfailed=${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
