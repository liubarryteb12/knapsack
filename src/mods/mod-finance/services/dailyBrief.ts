import { db } from '../../../db'
import type { DailyExpenseBrief } from '../../../core/capabilityContracts'
import {
  FINANCE_CATEGORY_LABELS,
  financeEntrySchema,
  type FinanceCategory,
} from '../schema'

export async function getDailyExpenseBrief(logicalDate: string): Promise<DailyExpenseBrief> {
  const rows = await db.financeEntries.where('date').equals(logicalDate).toArray()
  const counts = new Map<FinanceCategory, number>()
  let totalCents = 0
  let count = 0
  for (const row of rows) {
    const parsed = financeEntrySchema.safeParse(row)
    if (!parsed.success) continue
    totalCents += parsed.data.amountFen
    count++
    counts.set(parsed.data.category, (counts.get(parsed.data.category) ?? 0) + parsed.data.amountFen)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    logicalDate,
    totalCents,
    count,
    topCategory: top ? FINANCE_CATEGORY_LABELS[top] : '',
  }
}
