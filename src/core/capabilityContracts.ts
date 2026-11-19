export const SPECIAL_EXPENSE_LEDGER_TOPIC = 'capability:special-expense-ledger' as const

/** 看板人格目录：提示词库 WORK_LLM 条目的只读投影（BOARD_MODULE_SPEC §8.1） */
export const WORK_PROMPT_CATALOG_TOPIC = 'capability:work-prompt-catalog' as const

export interface WorkPromptProjection {
  id: string
  title: string
  systemRole: string
  templateBody: string
  outputFormat: 'MARKDOWN' | 'JSON' | 'TABLE' | 'CODE' | 'PLAIN'
  facets: { targetTool: string[]; domainTheme: string[]; styleTechnique: string[] }
  updatedAt: number
}

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
