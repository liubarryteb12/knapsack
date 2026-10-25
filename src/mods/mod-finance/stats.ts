import { addDays } from '../../utils/date'
import {
  FINANCE_CATEGORY_LABELS,
  type FinanceCategory,
  type FinanceEntry,
} from './schema'

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function entriesInMonth(entries: FinanceEntry[], month: string): FinanceEntry[] {
  return entries.filter((e) => monthOf(e.date) === month)
}

export function sumFen(entries: FinanceEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amountFen, 0)
}

export function dayFen(entries: FinanceEntry[], date: string): number {
  return sumFen(entries.filter((e) => e.date === date))
}

export interface CategoryStat {
  category: FinanceCategory
  label: string
  totalFen: number
  percent: number
}

export function categoryBreakdown(entries: FinanceEntry[]): CategoryStat[] {
  const total = sumFen(entries)
  const byCategory = new Map<FinanceCategory, number>()
  for (const entry of entries) {
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.amountFen)
  }
  return [...byCategory.entries()]
    .map(([category, totalFen]) => ({
      category,
      label: FINANCE_CATEGORY_LABELS[category],
      totalFen,
      percent: total > 0 ? (totalFen / total) * 100 : 0,
    }))
    .sort((a, b) => b.totalFen - a.totalFen)
}

export interface DayStat {
  date: string
  totalFen: number
}

export function last7Days(entries: FinanceEntry[], endDate: string): DayStat[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(endDate, index - 6)
    return { date, totalFen: dayFen(entries, date) }
  })
}
