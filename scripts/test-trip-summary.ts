/**
 * A6 旅行列表投影回归：完整聚合根只在详情页按需读取。
 *
 * 运行：npx tsx scripts/test-trip-summary.ts
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../src/db'
import { createTrip } from '../src/schema/trip'
import { useTripsStore } from '../src/stores/trips'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function main() {
  setActivePinia(createPinia())
  await db.trips.clear()
  const store = useTripsStore()

  const first = createTrip({
    name: '杭州行',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    destType: 'city',
    destCity: '杭州',
    totalBudgetFen: 100000,
  })
  first.expenses.push({
    id: 'expense-a',
    date: '2026-10-20',
    category: 'food',
    title: '晚餐',
    amountFen: 12500,
    payerId: first.members[0]!.id,
    split: { mode: 'equal', memberIds: [first.members[0]!.id] },
  })
  await db.trips.put(first)

  const second = createTrip({
    name: '山野行',
    startDate: '2026-11-01',
    endDate: '2026-11-03',
    destType: 'mountain',
    destCity: '安吉',
    totalBudgetFen: 0,
  })
  await db.trips.put(second)

  await store.loadSummaries()
  check('列表只加载摘要', store.summaries.length === 2)
  check('列表不保留完整行程', store.trips.length === 0)
  check('摘要包含已用金额', store.summaries.find((t) => t.id === first.id)?.usedFen === 12500)
  check('摘要包含模块开关', store.summaries[0]?.enabledModules.expenses === true)

  const summary = store.summaries.find((t) => t.id === first.id)!
  summary.enabledModules.expenses = false
  check('摘要修改不会污染数据库完整对象', (await db.trips.get(first.id))?.enabledModules.expenses === true)

  const full = await store.getTrip(first.id)
  check('详情按需读取完整行程', !!full && full.days.length === 3 && full.expenses.length === 1)
  check('完整行程只缓存当前聚合根', store.trips.length === 1)

  check('设置模块开关成功', await store.setTripModule(first.id, 'expenses', false))
  check('模块开关同步摘要', store.summaries.find((t) => t.id === first.id)?.enabledModules.expenses === false)
  check('模块开关落库', (await db.trips.get(first.id))?.enabledModules.expenses === false)

  full!.expenses.push({
    id: 'expense-b',
    date: '2026-10-21',
    category: 'transport',
    title: '打车',
    amountFen: 3500,
    payerId: full!.members[0]!.id,
    split: { mode: 'equal', memberIds: [full!.members[0]!.id] },
  })
  await store.saveTrip(full!)
  check('保存后摘要已用金额同步', store.summaries.find((t) => t.id === first.id)?.usedFen === 16000)

  const copy = await store.duplicateTrip(first.id)
  check('复制后列表摘要增加', !!copy && store.summaries.length === 3)
  check('复制后 ID 独立', !!copy && copy.id !== first.id)

  await store.deleteTrip(second.id)
  check('删除后摘要移除', !store.summaries.some((t) => t.id === second.id))

  await db.trips.clear()
  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
