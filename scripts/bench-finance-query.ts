/**
 * A4 消融：账房全量加载 vs 月份 + 近 7 日窗口查询。
 *
 * 运行：npx tsx scripts/bench-finance-query.ts
 */
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { addDays } from '../src/utils/date'
import { newFinanceEntry } from '../src/mods/mod-finance/schema'

function bytes(rows: unknown[]): number {
  return JSON.stringify(rows).length
}

async function main() {
  await db.financeEntries.clear()
  const entries = Array.from({ length: 5000 }, (_, index) => {
    const date = addDays('2026-01-01', index % 365)
    return newFinanceEntry({
      date,
      amountFen: 100 + (index % 9000),
      category: index % 2 === 0 ? 'food' : 'transport',
      note: `bench-${index}`,
    })
  })
  await db.financeEntries.bulkPut(entries)

  const t0 = performance.now()
  const full = await db.financeEntries.toArray()
  const fullMs = performance.now() - t0

  const t1 = performance.now()
  const [month, trend] = await Promise.all([
    db.financeEntries.where('date').between('2026-10-01', '2026-10-31', true, true).toArray(),
    db.financeEntries.where('date').between('2026-10-17', '2026-10-23', true, true).toArray(),
  ])
  const windowMs = performance.now() - t1
  const windowRows = [...new Map([...month, ...trend].map((row) => [row.id, row])).values()]

  console.log('A4 账房查询消融（5000 条）')
  console.log(`全量加载: ${full.length} 条, ${bytes(full)} bytes, ${fullMs.toFixed(2)} ms`)
  console.log(`月份窗口: ${windowRows.length} 条, ${bytes(windowRows)} bytes, ${windowMs.toFixed(2)} ms`)
  console.log(`窗口数据量降幅: ${Math.round((1 - windowRows.length / full.length) * 100)}%`)
  await db.financeEntries.clear()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
