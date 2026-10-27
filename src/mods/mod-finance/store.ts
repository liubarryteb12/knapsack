import { defineStore } from 'pinia'
import { db } from '../../db'
import type { SpecialExpenseLedgerEntry } from '../../core/capabilityContracts'
import { addDays, todayStr } from '../../utils/date'
import {
  financeEntrySchema,
  newFinanceEntry,
  parseFinanceEntry,
  travelCategoryToFinance,
  type FinanceCategory,
  type FinanceEntry,
  type FinanceNature,
} from './schema'
import { createFinanceBudget, financeBudgetSchema, type FinanceBudget } from './budget'

let loadSequence = 0

export type TripExpenseSelection = SpecialExpenseLedgerEntry

export interface ImportResult {
  imported: number
  skipped: number
  updated: number
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
    budgetFen: 0,
    currentMonth: todayStr().slice(0, 7),
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
        const [monthRows, trendRows, budgetRow] = await Promise.all([
          db.financeEntries.where('date').between(monthStart, monthEnd, true, true).toArray(),
          db.financeEntries.where('date').between(trendStart, endDate, true, true).toArray(),
          db.table<FinanceBudget, string>('mod_finance_budgets').get(month),
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
        this.budgetFen = budgetRow ? financeBudgetSchema.parse(budgetRow).amountFen : 0
        this.currentMonth = month
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
      natureTag?: FinanceNature
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
      patch: Partial<Pick<FinanceEntry, 'date' | 'amountFen' | 'category' | 'natureTag' | 'note'>>,
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
      let updated = 0
      try {
        await db.transaction('rw', db.financeEntries, async () => {
          const sourceKeys = selections.map((item) => `trip:${item.tripId}:${item.expenseId}`)
          const existing = new Map(
            sourceKeys.length === 0
              ? []
              : (await db.financeEntries.where('sourceKey').anyOf(sourceKeys).toArray()).map(
                  (entry) => [entry.sourceKey, entry] as const,
                ),
          )
          for (const item of selections) {
            const sourceKey = `trip:${item.tripId}:${item.expenseId}`
            const current = existing.get(sourceKey)
            const category = travelCategoryToFinance(item.category)
            const note = `${item.tripName} · ${item.title}`
            if (
              current &&
              current.amountFen === item.personalNetFen &&
              current.date === item.date &&
              current.category === category &&
              current.natureTag === 'TRIP_SPECIAL'
            ) {
              skipped++
              continue
            }
            if (current) {
              const next = financeEntrySchema.parse({
                ...current,
                date: item.date,
                amountFen: item.personalNetFen,
                category,
                natureTag: 'TRIP_SPECIAL',
                note,
                updatedAt: Date.now(),
              })
              await db.financeEntries.put(next)
              existing.set(sourceKey, next)
              updated++
              continue
            }
            const entry = newFinanceEntry({
              date: item.date,
              amountFen: item.personalNetFen,
              category,
              note,
              source: 'trip',
              sourceTripId: item.tripId,
              sourceExpenseId: item.expenseId,
            })
            await db.financeEntries.put(entry)
            existing.set(sourceKey, entry)
            imported++
          }
        })
        await this.load()
        return { imported, skipped, updated }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        this.error = error
        return { imported, skipped, updated, error }
      } finally {
        this.saving = false
      }
    },

    async saveBudget(month: string, amountFen: number): Promise<boolean> {
      this.saving = true
      this.error = ''
      try {
        const budget = createFinanceBudget(month, amountFen)
        await db.table<FinanceBudget, string>('mod_finance_budgets').put(budget)
        if (month === this.currentMonth) {
          this.budgetFen = amountFen
        }
        return true
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
        return false
      } finally {
        this.saving = false
      }
    },
  },
})
