import { z } from 'zod'

export const FINANCE_BUDGET_FORMAT = 'finance-budget.v1'

export const financeBudgetSchema = z.object({
  format: z.literal(FINANCE_BUDGET_FORMAT),
  month: z.string().regex(/^\d{4}-\d{2}$/, '月份格式应为 yyyy-MM'),
  amountFen: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})

export type FinanceBudget = z.infer<typeof financeBudgetSchema>

export function createFinanceBudget(
  month: string,
  amountFen: number,
  now = Date.now(),
): FinanceBudget {
  return financeBudgetSchema.parse({
    format: FINANCE_BUDGET_FORMAT,
    month,
    amountFen,
    updatedAt: now,
  })
}
