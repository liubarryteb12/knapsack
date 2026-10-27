import { addDays } from '../../utils/date'
import { computeComposition } from '../../engines/ledger-engine/composition-analyzer'
import {
  FINANCE_CATEGORY_LABELS,
  FINANCE_NATURE_LABELS,
  type FinanceCategory,
  type FinanceEntry,
  type FinanceNature,
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

export function compositionEntries(entries: FinanceEntry[], includeTrip: boolean): FinanceEntry[] {
  return includeTrip ? entries : entries.filter((entry) => entry.natureTag !== 'TRIP_SPECIAL')
}

export interface CategoryStat {
  category: FinanceCategory
  label: string
  totalFen: number
  percent: number
}

export interface NatureStat {
  nature: FinanceNature
  label: string
  totalFen: number
  percent: number
}

export function categoryBreakdown(entries: FinanceEntry[]): CategoryStat[] {
  const byCategory = new Map<FinanceCategory, number>()
  for (const entry of entries) {
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.amountFen)
  }
  const allocations = computeComposition(
    [...byCategory.entries()].map(([category, amountCents]) => ({
      key: category,
      amountCents,
    })),
  )
  return allocations
    .map((allocation) => {
      const category = allocation.key as FinanceCategory
      return {
        category,
        label: FINANCE_CATEGORY_LABELS[category],
        totalFen: allocation.amountCents,
        percent: allocation.percent,
      }
    })
    .sort((a, b) => b.totalFen - a.totalFen)
}

export function natureBreakdown(entries: FinanceEntry[]): NatureStat[] {
  const byNature = new Map<FinanceNature, number>()
  for (const entry of entries) {
    byNature.set(entry.natureTag, (byNature.get(entry.natureTag) ?? 0) + entry.amountFen)
  }
  return computeComposition(
    [...byNature.entries()].map(([nature, amountCents]) => ({ key: nature, amountCents })),
  )
    .map((allocation) => {
      const nature = allocation.key as FinanceNature
      return {
        nature,
        label: FINANCE_NATURE_LABELS[nature],
        totalFen: allocation.amountCents,
        percent: allocation.percent,
      }
    })
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
