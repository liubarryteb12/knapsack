/**
 * 每日计划跨零点、逻辑日期与跨日顺延契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-daily-rollover.ts
 */
import {
  createDailyDay,
  dailyDaySchema,
  newDailyTask,
} from '../src/mods/mod-daily/schema'
import { rolloverIncompleteTasks } from '../src/mods/mod-daily/rollover'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function expectThrow(name: string, fn: () => unknown) {
  try {
    await fn()
    check(name, false)
  } catch {
    check(name, true)
  }
}

async function main() {
  const crossMidnight = newDailyTask({
    title: '看完电影',
    startTime: '23:30',
    endTime: '01:30',
  })
  check('跨零点开始分钟正确', crossMidnight.startMinute === 1410)
  check('跨零点结束分钟顺延到次日', crossMidnight.endMinute === 1530)
  check('跨零点任务通过 Schema', dailyDaySchema.safeParse({
    ...createDailyDay('2026-10-27'),
    tasks: [crossMidnight],
  }).success)
  await expectThrow('结束时间超过次日 03:00 被拒', () => newDailyTask({
    title: '太晚',
    startTime: '23:30',
    endTime: '04:00',
  }))
  await expectThrow('开始时间不能超过 24:00', () => newDailyTask({
    title: '非法',
    startTime: '24:00',
  }))

  const yesterday = {
    ...createDailyDay('2026-10-26', 100),
    tasks: [
      {
        ...newDailyTask({ title: '未完成 A', startTime: '09:00', endTime: '10:00' }, 101),
        id: 'task-a',
      },
      {
        ...newDailyTask({ title: '已完成 B' }, 102),
        id: 'task-b',
        done: true,
        status: 'DONE' as const,
      },
    ],
  }
  const today = createDailyDay('2026-10-27', 200)
  const first = rolloverIncompleteTasks(yesterday, today, 300)
  check('只顺延未完成任务', first.moved === 1)
  check('昨日原记录保留并标记 ROLLED_OVER', first.sourceDay.tasks[0]?.status === 'ROLLED_OVER')
  check('今日生成新记录而非改历史', first.targetDay.tasks[0]?.id !== 'task-a')
  check('新记录保存来源链', first.targetDay.tasks[0]?.originTaskId === 'task-a')
  check('首次顺延计数为 1', first.targetDay.tasks[0]?.rolloverCount === 1)

  const repeated = rolloverIncompleteTasks(first.sourceDay, first.targetDay, 400)
  check('重复顺延幂等且不生成重复任务', repeated.moved === 0 && repeated.targetDay.tasks.length === 1)

  const threeDays = {
    ...first.targetDay,
    tasks: [
      {
        ...first.targetDay.tasks[0]!,
        id: 'task-a-day2',
        originTaskId: 'task-a',
        rolloverCount: 2,
      },
    ],
  }
  const third = rolloverIncompleteTasks(threeDays, createDailyDay('2026-10-28', 500), 600)
  check('连续顺延累计次数', third.targetDay.tasks[0]?.rolloverCount === 3)
  check('连续顺延保留根来源', third.targetDay.tasks[0]?.originTaskId === 'task-a')

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
