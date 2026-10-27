/** mod-finance 数据契约：纯本地记账，不接支付、转账或金融接口。 */
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { toDateStr } from '../../utils/date'

export const FINANCE_FORMAT = 'finance-entry.v1'

export const financeDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 yyyy-MM-dd')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00`)
    return !Number.isNaN(parsed.getTime()) && toDateStr(parsed) === value
  }, '日期不存在')

export const financeCategorySchema = z.enum([
  'food',
  'transport',
  'stay',
  'shopping',
  'entertainment',
  'health',
  'other',
])

export const financeSourceSchema = z.enum(['manual', 'trip'])
export const financeNatureSchema = z.enum([
  'ESSENTIAL',
  'IMPROVEMENT',
  'HEDONIC',
  'TRIP_SPECIAL',
])

export const financeEntrySchema = z
  .object({
    format: z.literal(FINANCE_FORMAT),
    id: z.string().min(1),
    date: financeDateSchema,
    amountFen: z.number().int().min(1, '金额必须大于 0'),
    category: financeCategorySchema,
    natureTag: financeNatureSchema.default('IMPROVEMENT'),
    note: z.string().max(500).default(''),
    source: financeSourceSchema.default('manual'),
    sourceTripId: z.string().min(1).nullable().default(null),
    sourceExpenseId: z.string().min(1).nullable().default(null),
    /** 唯一来源键：manual:<id> 或 trip:<tripId>:<expenseId> */
    sourceKey: z.string().min(1),
    createdAt: z.number().int().min(0),
    updatedAt: z.number().int().min(0),
  })
  .refine(
    (entry) =>
      entry.source === 'trip'
        ? !!entry.sourceTripId &&
          !!entry.sourceExpenseId &&
          entry.sourceKey === `trip:${entry.sourceTripId}:${entry.sourceExpenseId}`
        : !entry.sourceTripId &&
          !entry.sourceExpenseId &&
          entry.sourceKey === `manual:${entry.id}`,
    { message: '来源字段与来源键不一致' },
  )

export type FinanceCategory = z.infer<typeof financeCategorySchema>
export type FinanceSource = z.infer<typeof financeSourceSchema>
export type FinanceNature = z.infer<typeof financeNatureSchema>
export type FinanceEntry = z.infer<typeof financeEntrySchema>

export interface NewFinanceEntryInput {
  date: string
  amountFen: number
  category: FinanceCategory
  natureTag?: FinanceNature
  note?: string
  source?: FinanceSource
  sourceTripId?: string | null
  sourceExpenseId?: string | null
}

export function newFinanceEntry(input: NewFinanceEntryInput, now = Date.now()): FinanceEntry {
  const id = nanoid(12)
  const source = input.source ?? 'manual'
  const natureTag = input.natureTag ?? defaultNatureFor(input.category, source)
  const sourceKey =
    source === 'trip'
      ? `trip:${input.sourceTripId}:${input.sourceExpenseId}`
      : `manual:${id}`
  return financeEntrySchema.parse({
    format: FINANCE_FORMAT,
    id,
    date: input.date,
    amountFen: input.amountFen,
    category: input.category,
    natureTag,
    note: input.note ?? '',
    source,
    sourceTripId: source === 'trip' ? input.sourceTripId : null,
    sourceExpenseId: source === 'trip' ? input.sourceExpenseId : null,
    sourceKey,
    createdAt: now,
    updatedAt: now,
  })
}

export function parseFinanceEntry(value: unknown): FinanceEntry {
  return financeEntrySchema.parse(value)
}

export const FINANCE_CATEGORY_LABELS: Record<FinanceCategory, string> = {
  food: '餐饮',
  transport: '交通',
  stay: '住宿',
  shopping: '购物',
  entertainment: '娱乐',
  health: '健康',
  other: '其他',
}

export const FINANCE_NATURE_LABELS: Record<FinanceNature, string> = {
  ESSENTIAL: '生存刚需',
  IMPROVEMENT: '品质改善',
  HEDONIC: '享受冲动',
  TRIP_SPECIAL: '旅行专项',
}

export function defaultNatureFor(category: FinanceCategory, source: FinanceSource): FinanceNature {
  if (source === 'trip') return 'TRIP_SPECIAL'
  if (category === 'food' || category === 'transport' || category === 'stay') return 'ESSENTIAL'
  if (category === 'shopping' || category === 'entertainment') return 'HEDONIC'
  return 'IMPROVEMENT'
}

export function travelCategoryToFinance(category: string): FinanceCategory {
  if (category === 'food' || category === 'transport' || category === 'stay') return category
  if (category === 'play') return 'entertainment'
  return 'other'
}
