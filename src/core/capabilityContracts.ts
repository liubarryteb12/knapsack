export const SPECIAL_EXPENSE_LEDGER_TOPIC = 'capability:special-expense-ledger' as const

export type SharedExpenseCategory = 'transport' | 'stay' | 'food' | 'play' | 'other'

/** Read-only projection. It never exposes another module's storage rows. */
export interface SpecialExpenseLedgerEntry {
  tripId: string
  tripName: string
  expenseId: string
  date: string
  category: SharedExpenseCategory
  title: string
  personalNetFen: number
}

export const DAILY_EXPENSE_BRIEF_TOPIC = 'capability:daily-expense-brief' as const

export interface DailyExpenseBrief {
  logicalDate: string
  totalCents: number
  count: number
  topCategory: string
}

export interface DailyTripContext {
  tripId: string
  tripName: string
  startDate: string
  endDate: string
  destCity: string
  dayTitle: string
}
