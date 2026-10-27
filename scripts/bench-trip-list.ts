/**
 * A6 消融：旅行完整聚合根全量加载 vs 摘要流式投影。
 *
 * 运行：npx tsx scripts/bench-trip-list.ts
 */
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { createTrip } from '../src/schema/trip'
import { toTripSummary } from '../src/mods/mod-trip/tripSummary'

function bytes(value: unknown): number {
  return JSON.stringify(value).length
}

async function main() {
  await db.trips.clear()
  const trips = Array.from({ length: 1700 }, (_, index) => {
    const trip = createTrip({
      name: `压测旅行 ${index}`,
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      destType: index % 2 === 0 ? 'city' : 'mountain',
      destCity: `城市 ${index % 30}`,
      totalBudgetFen: 500000,
    })
    const memberId = trip.members[0]!.id
    trip.expenses = Array.from({ length: 12 }, (_, expenseIndex) => ({
      id: `expense-${index}-${expenseIndex}`,
      date: `2026-10-${String((expenseIndex % 5) + 1).padStart(2, '0')}`,
      category: expenseIndex % 2 === 0 ? 'food' : 'transport',
      title: `花费 ${expenseIndex}`,
      amountFen: 1000 + expenseIndex * 100,
      payerId: memberId,
      split: { mode: 'equal', memberIds: [memberId] },
    }))
    return trip
  })
  await db.trips.bulkPut(trips)

  const t0 = performance.now()
  const full = await db.trips.toArray()
  const fullMs = performance.now() - t0

  const t1 = performance.now()
  const summaries = []
  await db.trips.each((trip) => {
    summaries.push(toTripSummary(trip))
  })
  const summaryMs = performance.now() - t1

  const firstPage = summaries.slice(0, 24)
  console.log('A6 旅行列表消融（1700 个旅行，每个 5 天 + 12 笔花费）')
  console.log(`完整全量: ${full.length} 条, ${bytes(full)} bytes, ${fullMs.toFixed(2)} ms`)
  console.log(`摘要流式: ${summaries.length} 条, ${bytes(summaries)} bytes, ${summaryMs.toFixed(2)} ms`)
  console.log(`首屏 24 张卡片摘要: ${bytes(firstPage)} bytes`)
  console.log(`常驻数据量降幅: ${Math.round((1 - bytes(summaries) / bytes(full)) * 100)}%`)

  await db.trips.clear()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
