/**
 * Phase 3 mod-finance 回归：金额、分类统计、旅行花费导入去重和旅行表只读。
 *
 * 运行：npx tsx scripts/test-finance.ts
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../src/db'
import { createTrip } from '../src/schema/trip'
import {
  newFinanceEntry,
  travelCategoryToFinance,
  type FinanceEntry,
} from '../src/mods/mod-finance/schema'
import { categoryBreakdown, last7Days, sumFen } from '../src/mods/mod-finance/stats'
import { useFinanceStore, type TripExpenseSelection } from '../src/mods/mod-finance/store'

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

function entry(date: string, amountFen: number, category: FinanceEntry['category']): FinanceEntry {
  return newFinanceEntry({ date, amountFen, category })
}

async function main() {
  console.log('finance schema')
  const manual = entry('2026-10-23', 3650, 'food')
  check('手动账目可创建', manual.source === 'manual' && manual.amountFen === 3650)
  check('手动来源键稳定', manual.sourceKey === `manual:${manual.id}`)
  await expectThrow('金额不能为 0', () => newFinanceEntry({ date: '2026-10-23', amountFen: 0, category: 'food' }))
  await expectThrow('金额不能是小数分', () =>
    newFinanceEntry({ date: '2026-10-23', amountFen: 1.5, category: 'food' }),
  )
  await expectThrow('非法日期被拒', () =>
    newFinanceEntry({ date: '2026-02-30', amountFen: 100, category: 'food' }),
  )
  check('旅行 play 映射为娱乐', travelCategoryToFinance('play') === 'entertainment')

  console.log('统计守恒')
  const entries = [
    entry('2026-10-20', 1000, 'food'),
    entry('2026-10-21', 2000, 'transport'),
    entry('2026-10-22', 3000, 'food'),
  ]
  const breakdown = categoryBreakdown(entries)
  check('分类统计总额守恒', sumFen(entries) === breakdown.reduce((n, x) => n + x.totalFen, 0))
  check('餐饮分类汇总正确', breakdown.find((x) => x.category === 'food')?.totalFen === 4000)
  check('近 7 日包含 7 天', last7Days(entries, '2026-10-23').length === 7)
  check('近 7 日金额正确', last7Days(entries, '2026-10-23').find((d) => d.date === '2026-10-21')?.totalFen === 2000)

  console.log('store 与旅行导入')
  setActivePinia(createPinia())
  await db.financeEntries.clear()
  await db.trips.clear()
  const store = useFinanceStore()
  await store.load()

  const added = await store.add({ date: '2026-10-23', amountFen: 500, category: 'shopping' })
  check('账目可新增', !!added && store.entries.length === 1)
  check('账目可编辑', added ? await store.update(added.id, { amountFen: 800, note: '改过' }) : false)
  check('编辑后金额正确', store.entries[0]?.amountFen === 800 && store.entries[0]?.note === '改过')
  check('账目可删除', added ? await store.remove(added.id) : false)
  check('删除后列表为空', store.entries.length === 0)

  const trip = createTrip({
    name: '账房联动测试',
    startDate: '2026-10-23',
    endDate: '2026-10-24',
    destType: 'city',
    destCity: '杭州',
    totalBudgetFen: 100000,
  })
  trip.expenses.push({
    id: 'expense-import-1',
    date: '2026-10-23',
    category: 'play',
    title: '景区门票',
    amountFen: 12000,
    payerId: trip.members[0]!.id,
    split: { mode: 'equal', memberIds: [trip.members[0]!.id] },
  })
  await db.trips.put(trip)
  const beforeTrip = JSON.stringify(await db.trips.get(trip.id))
  const selection: TripExpenseSelection = {
    tripId: trip.id,
    tripName: trip.name,
    expense: trip.expenses[0]!,
  }

  const first = await store.importFromTrips([selection])
  check('旅行花费可导入', first.imported === 1 && first.skipped === 0)
  check('旅行分类映射正确', store.entries[0]?.category === 'entertainment')
  check('导入来源键正确', store.entries[0]?.sourceKey === `trip:${trip.id}:${trip.expenses[0]!.id}`)
  const second = await store.importFromTrips([selection])
  check('重复导入被跳过', second.imported === 0 && second.skipped === 1)
  check('旅行表未被修改', JSON.stringify(await db.trips.get(trip.id)) === beforeTrip)

  await db.financeEntries.clear()
  await db.financeEntries.bulkPut([
    newFinanceEntry({ date: '2026-09-01', amountFen: 1000, category: 'food' }),
    newFinanceEntry({ date: '2026-09-10', amountFen: 2000, category: 'transport' }),
    newFinanceEntry({ date: '2026-10-23', amountFen: 3000, category: 'shopping' }),
  ])
  await store.loadMonth('2026-09', '2026-09-15')
  check('按月窗口加载目标月份', store.entries.some((e) => e.date === '2026-09-01'))
  check('按月窗口加载近 7 日趋势', store.entries.some((e) => e.date === '2026-09-10'))
  check('按月窗口不加载远月数据', !store.entries.some((e) => e.date === '2026-10-23'))
  await Promise.all([
    store.loadMonth('2026-09', '2026-09-15'),
    store.loadMonth('2026-10', '2026-10-23'),
  ])
  check('并发切换月份最终保留最后一次请求', store.entries.some((e) => e.date === '2026-10-23'))
  check('旧月份请求晚返回不覆盖新月份', !store.entries.some((e) => e.date === '2026-09-01'))

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
