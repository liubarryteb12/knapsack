/**
 * 旅行 → 账房只读净实付能力总线契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-trip-finance-bridge.ts
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../src/db'
import { createModRegistry } from '../src/core/modRegistry'
import { STATIC_MOD_MANIFESTS } from '../src/mods/manifest-index'
import { createTrip } from '../src/schema/trip'
import { useFinanceStore } from '../src/mods/mod-finance/store'
import type { DailyExpenseBrief } from '../src/core/capabilityContracts'
import { getDailyTripContext } from '../src/mods/mod-trip/services/dailyTripContext'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function main() {
  await db.trips.clear()
  await db.financeEntries.clear()

  const trip = createTrip({
    name: '净额桥接测试',
    startDate: '2026-10-27',
    endDate: '2026-10-28',
    destType: 'city',
    destCity: '杭州',
    totalBudgetFen: 500000,
  })
  trip.members.push(
    { id: 'm2', name: '甲', role: 'member' },
    { id: 'm3', name: '乙', role: 'member' },
    { id: 'm4', name: '丙', role: 'member' },
  )
  const me = trip.members[0]!
  trip.expenses.push(
    {
      id: 'hotel',
      date: '2026-10-27',
      category: 'stay',
      title: '酒店',
      amountFen: 200000,
      payerId: me.id,
      split: { mode: 'equal', memberIds: trip.members.map((member) => member.id) },
    },
    {
      id: 'snack',
      date: '2026-10-27',
      category: 'food',
      title: '个人特产',
      amountFen: 20000,
      payerId: me.id,
      split: { mode: 'equal', memberIds: [me.id] },
    },
  )
  await db.trips.put(trip)

  const registry = createModRegistry(STATIC_MOD_MANIFESTS)
  await registry.initialize()
  const ledgers = await registry.capabilities.query<
    Array<{
      tripId: string
      expenseId: string
      personalNetFen: number
      date: string
      category: string
      title: string
      tripName: string
    }>
  >('capability:special-expense-ledger')
  const entries = ledgers.flat()
  const hotel = entries.find((entry) => entry.expenseId === 'hotel')
  const snack = entries.find((entry) => entry.expenseId === 'snack')

  check('旅行能力返回个人分摊净实付', hotel?.personalNetFen === 50000)
  check('个人独享花费按全额返回', snack?.personalNetFen === 20000)
  check('能力结果包含稳定来源字段', hotel?.tripId === trip.id && hotel.tripName === trip.name)

  setActivePinia(createPinia())
  const finance = useFinanceStore()
  await finance.load()
  const first = await finance.importFromTrips(entries)
  check('账房导入个人净额而非垫付毛额', first.imported === 2 && finance.entries.reduce((sum, row) => sum + row.amountFen, 0) === 70000)

  const briefs = await registry.capabilities.query<DailyExpenseBrief>(
    'capability:daily-expense-brief',
    '2026-10-27',
  )
  check('每日摘要能力返回只读汇总', briefs[0]?.count === 2 && briefs[0]?.totalCents === 70000)
  check('旅行日期能力返回当前行程', (await getDailyTripContext('2026-10-27'))?.tripId === trip.id)
  check('旅行横幅与账房复盘卡片已挂入标准插槽',
    registry.slots.resolve('daily:header-banner').length === 1 &&
      registry.slots.resolve('daily:review-footer').length === 2)

  await db.financeEntries.clear()
  await finance.load()
  await finance.importFromTrips([{ ...hotel!, personalNetFen: 80000 }])
  const corrected = await finance.importFromTrips([{ ...hotel!, personalNetFen: 50000 }])
  check('旧毛额或修订净额会被改正', corrected.updated === 1)
  check('修订后只保留一条来源账目', finance.entries.filter((row) => row.sourceKey.endsWith(':hotel')).length === 1)
  check('修订后金额为最新净实付', finance.entries.find((row) => row.sourceKey.endsWith(':hotel'))?.amountFen === 50000)

  await registry.setEnabled('mod-trip', false)
  const disabled = await registry.capabilities.query('capability:special-expense-ledger')
  check('关闭旅行模块后能力查询降级为空数组', disabled.length === 0)
  check('关闭旅行模块后旅行横幅插槽卸载', registry.slots.resolve('daily:header-banner').length === 0)

  await db.trips.clear()
  await db.financeEntries.clear()
  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
