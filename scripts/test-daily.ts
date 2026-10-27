/**
 * Phase 2 mod-daily 回归：schema、日期隔离、任务 CRUD、备忘与复盘持久化。
 *
 * 运行：npx tsx scripts/test-daily.ts
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../src/db'
import {
  createDailyDay,
  dailyDaySchema,
  newDailyTask,
  parseDailyDay,
} from '../src/mods/mod-daily/schema'
import { useDailyStore } from '../src/mods/mod-daily/store'

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
  console.log('mod-daily schema')
  const day = createDailyDay('2026-10-23')
  check('空记录可创建', dailyDaySchema.safeParse(day).success)
  check('日期键格式正确', day.date === '2026-10-23')
  check('默认三问为空', day.review.wins === '' && day.review.blockers === '' && day.review.tomorrow === '')
  check('空文本合法', day.memo === '' && day.tasks.length === 0)

  await expectThrow('非法日期被拒', () => createDailyDay('2026/10/23'))
  await expectThrow('不存在的日期被拒', () => createDailyDay('2026-02-30'))
  await expectThrow('非法小时被拒', () =>
    newDailyTask({ title: '坏小时', startTime: '24:00' }),
  )
  await expectThrow('非法分钟被拒', () =>
    newDailyTask({ title: '坏分钟', startTime: '10:60' }),
  )
  await expectThrow('只有结束时间被拒', () =>
    newDailyTask({ title: '缺开始', endTime: '10:00' }),
  )
  await expectThrow('结束早于开始被拒', () =>
    newDailyTask({ title: '坏时间', startTime: '10:00', endTime: '09:00' }),
  )
  const task = newDailyTask({ title: '整理照片 🎒', startTime: '09:00', endTime: '10:00' })
  check('任务含稳定 id', task.id.length > 0)
  check('任务时间与 Emoji 保留', task.title.includes('🎒') && task.startTime === '09:00')
  const legacyDay = parseDailyDay({
    ...createDailyDay('2026-10-27'),
    tasks: [{
      id: 'legacy-time',
      title: '旧时间格式',
      startTime: '23:30',
      endTime: '01:30',
      done: false,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    }],
  })
  check('旧 HH:mm 数据自动补齐分钟轴', legacyDay.tasks[0]?.startMinute === 1410 && legacyDay.tasks[0]?.endMinute === 1530)

  console.log('store 日期隔离与持久化')
  setActivePinia(createPinia())
  await db.dailyDays.clear()
  const store = useDailyStore()

  await store.load('2026-10-23')
  const first = await store.addTask({ title: '写周报', startTime: '09:30' })
  check('任务可新增', !!first)
  store.setMemo('备忘 🎒\n第二行')
  store.setReview('wins', '完成了一件小事')
  store.setReview('blockers', '下午有点分心')
  store.setReview('tomorrow', '先做最重要的事')
  store.setMemo('同一天重载前的内容')
  await store.load('2026-10-23')
  check('同一天重载前会先保存待写内容', store.day?.memo === '同一天重载前的内容')
  await store.flushSave()

  const savedFirst = await db.dailyDays.get('2026-10-23')
  check('备忘多行/Emoji 入库', savedFirst?.memo === '同一天重载前的内容')
  check('三问复盘入库', savedFirst?.review.tomorrow === '先做最重要的事')

  await store.load('2026-10-25')
  store.setMemo('并发保存 A')
  const saveA = store.flushSave()
  store.setMemo('并发保存 B')
  const saveB = store.flushSave()
  check('并发保存都能完成', (await Promise.all([saveA, saveB])).every(Boolean))
  const concurrent = await db.dailyDays.get('2026-10-25')
  check('并发保存最后保留较新的内容', concurrent?.memo === '并发保存 B')

  await store.load('2026-10-24')
  await store.addTask({ title: '明天任务' })
  await store.flushSave()
  const savedSecond = await db.dailyDays.get('2026-10-24')
  check('第二天数据独立', savedSecond?.tasks.length === 1 && savedSecond.tasks[0]!.title === '明天任务')

  await store.load('2026-10-23')
  check('切回日期恢复任务', store.day?.tasks[0]?.title === '写周报')
  check('切回日期恢复备忘', store.day?.memo === '同一天重载前的内容')
  check('切回日期恢复复盘', store.day?.review.blockers === '下午有点分心')

  const taskId = store.day!.tasks[0]!.id
  check('任务可完成', await store.toggleTask(taskId) && store.day?.tasks[0]?.done === true)
  check('任务可编辑', await store.updateTask(taskId, { title: '写周报（改）' }) && store.day?.tasks[0]?.title === '写周报（改）')
  check('任务可删除', await store.removeTask(taskId) && store.day?.tasks.length === 0)

  const undoable = await store.addTask({ title: '撤销测试' })
  check('新增后可撤销', !!undoable && store.canUndo)
  check('撤销恢复新增前状态', await store.undo() && !store.day?.tasks.some((item) => item.title === '撤销测试'))
  check('撤销后可重做', store.canRedo && await store.redo() && store.day?.tasks.some((item) => item.title === '撤销测试'))

  const movable = await store.addTask({ title: '拖拽排期', startTime: '09:00', endTime: '10:00' })
  check('时间块可拖拽移动', movable ? await store.moveTaskTime(movable.id, 600, 690) : false)
  check('拖拽后分钟与显示时间一致', store.day?.tasks.find((task) => task.id === movable?.id)?.startTime === '10:00')
  check('拖拽移动可撤销', await store.undo() && store.day?.tasks.find((task) => task.id === movable?.id)?.startTime === '09:00')

  await db.dailyDays.clear()
  await store.load('2026-10-26')
  await store.addTask({ title: '跨日顺延撤销测试' })
  await store.load('2026-10-27')
  check('进入次日能发现昨日未完成', store.rolloverAvailable === 1)
  check('顺延事务落库成功', await store.rolloverFromPrevious() === 1 && store.day?.tasks.length === 1)
  check('撤销顺延同时恢复昨日原任务', await store.undo() && store.day?.tasks.length === 0 && store.rolloverAvailable === 1)
  const restoredSource = await db.dailyDays.get('2026-10-26')
  check('撤销后昨日任务不再是 ROLLED_OVER', restoredSource?.tasks[0]?.status === 'TODO')
  check('重做顺延恢复今日副本', await store.redo() && store.day?.tasks[0]?.originTaskId !== null)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
