import { defineStore } from 'pinia'
import { db } from '../../db'
import type { Expense } from '../../schema/trip'
import { addDays, todayStr } from '../../utils/date'
import {
  financeEntrySchema,
  newFinanceEntry,
  parseFinanceEntry,
  travelCategoryToFinance,
  type FinanceCategory,
  type FinanceEntry,
} from './schema'

let loadSequence = 0

export interface TripExpenseSelection {
  tripId: string
  tripName: string
  expense: Expense
}

export interface ImportResult {
  imported: number
  skipped: number
  error?: string
}

function sortEntries(entries: FinanceEntry[]): FinanceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return b.createdAt - a.createdAt
  })
}

export const useFinanceStore = defineStore('finance', {
  state: () => ({
    entries: [] as FinanceEntry[],
    loading: false,
    saving: false,
    error: '',
  }),

  actions: {
    async load(): Promise<void> {
      await this.loadMonth(todayStr().slice(0, 7), todayStr())
    },

    async loadMonth(month: string, endDate = todayStr()): Promise<void> {
      const sequence = ++loadSequence
      this.loading = true
      this.error = ''
      try {
        const monthStart = `${month}-01`
        const monthEndDate = new Date(`${monthStart}T00:00:00`)
        monthEndDate.setMonth(monthEndDate.getMonth() + 1)
        monthEndDate.setDate(0)
        const monthEnd = `${month}-${String(monthEndDate.getDate()).padStart(2, '0')}`
        const trendStart = addDays(endDate, -6)
        const [monthRows, trendRows] = await Promise.all([
          db.financeEntries.where('date').between(monthStart, monthEnd, true, true).toArray(),
          db.financeEntries.where('date').between(trendStart, endDate, true, true).toArray(),
        ])
        if (sequence !== loadSequence) return
        const rows = [...new Map([...monthRows, ...trendRows].map((row) => [row.id, row])).values()]
        const parsed: FinanceEntry[] = []
        for (const row of rows) {
          try {
            parsed.push(parseFinanceEntry(row))
          } catch {
            // 单条损坏数据不应阻塞整个账房页面；保留错误提示供用户排查。
            this.error = '有 1 条本地账目无法解析，已跳过'
          }
        }
        this.entries = sortEntries(parsed)
      } catch (e) {
        if (sequence === loadSequence) {
          this.error = e instanceof Error ? e.message : String(e)
        }
      } finally {
        if (sequence === loadSequence) this.loading = false
      }
    },

    async add(input: {
      date: string
      amountFen: number
      category: FinanceCategory
      note?: string
    }): Promise<FinanceEntry | null> {
      this.saving = true
      this.error = ''
      try {
        const entry = newFinanceEntry(input)
        await db.financeEntries.put(entry)
        this.entries = sortEntries([entry, ...this.entries])
        return entry
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
        return null
      } finally {
        this.saving = false
      }
    },

    async update(
      id: string,
      patch: Partial<Pick<FinanceEntry, 'date' | 'amountFen' | 'category' | 'note'>>,
    ): Promise<boolean> {
      const current = this.entries.find((e) => e.id === id)
      if (!current) return false
      this.saving = true
      this.error = ''
      try {
        const next = financeEntrySchema.parse({
          ...current,
          ...patch,
          updatedAt: Date.now(),
        })
        await db.financeEntries.put(next)
        this.entries = sortEntries(this.entries.map((e) => (e.id === id ? next : e)))
        return true
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
        return false
      } finally {
        this.saving = false
      }
    },

    async remove(id: string): Promise<boolean> {
      this.saving = true
      this.error = ''
      try {
        await db.financeEntries.delete(id)
        this.entries = this.entries.filter((e) => e.id !== id)
        return true
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
        return false
      } finally {
        this.saving = false
      }
    },

    async importFromTrips(selections: TripExpenseSelection[]): Promise<ImportResult> {
      this.saving = true
      this.error = ''
      let imported = 0
      let skipped = 0
      try {
        await db.transaction('rw', db.financeEntries, async () => {
          const sourceKeys = selections.map(
            (item) => `trip:${item.tripId}:${item.expense.id}`,
          )
          const existing = new Set(
            sourceKeys.length === 0
              ? []
              : (await db.financeEntries.where('sourceKey').anyOf(sourceKeys).toArray()).map(
                  (entry) => entry.sourceKey,
                ),
          )
          for (const item of selections) {
            const sourceKey = `trip:${item.tripId}:${item.expense.id}`
            if (existing.has(sourceKey)) {
              skipped++
              continue
            }
            const entry = newFinanceEntry({
              date: item.expense.date,
              amountFen: item.expense.amountFen,
              category: travelCategoryToFinance(item.expense.category),
              note: `${item.tripName} · ${item.expense.title}`,
              source: 'trip',
              sourceTripId: item.tripId,
              sourceExpenseId: item.expense.id,
            })
            await db.financeEntries.put(entry)
            existing.add(sourceKey)
            imported++
          }
        })
        await this.load()
        return { imported, skipped }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        this.error = error
        return { imported, skipped, error }
      } finally {
        this.saving = false
      }
    },
  },
})
