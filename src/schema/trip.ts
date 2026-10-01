import { z } from 'zod'
import { nanoid } from 'nanoid'

/** 旅行计划唯一 Schema（trip.v1），内部写入、文件导入、AI 返回结果都过这道校验 */

/** yyyy-MM-dd */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 yyyy-MM-dd')

/** HH:mm */
export const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, '时间格式应为 HH:mm')

/** 成员角色 */
export const memberRoleSchema = z.enum(['owner', 'member'])

export const memberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, '成员名不能为空'),
  role: memberRoleSchema,
})

/** 行程条目类型 */
export const itemTypeSchema = z.enum(['transport', 'stay', 'food', 'play', 'other'])

export const tripItemSchema = z.object({
  id: z.string().min(1),
  time: timeSchema.nullable().default(null),
  type: itemTypeSchema,
  title: z.string().min(1, '条目标题不能为空'),
  note: z.string().default(''),
  linkedExpenseId: z.string().nullable().default(null),
  done: z.boolean().default(false),
})

export const tripDaySchema = z.object({
  date: dateSchema,
  items: z.array(tripItemSchema).default([]),
})

/** 花费分类 */
export const expenseCategorySchema = z.enum(['transport', 'stay', 'food', 'play', 'other'])

/** 花费分摊：equal 均分 / shares 按份 / custom 自定义金额 */
export const expenseSplitSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('equal'),
    memberIds: z.array(z.string()).min(1, '均分至少选择一名成员'),
  }),
  z.object({
    mode: z.literal('shares'),
    memberIds: z.array(z.string()).min(1, '按份分摊至少选择一名成员'),
    /** 与 memberIds 一一对应的份数，整数 */
    shares: z.array(z.number().int().min(1)),
  }).refine((s) => s.memberIds.length === s.shares.length, {
    message: '份数与成员数量不一致',
  }),
  z.object({
    mode: z.literal('custom'),
    /** memberId → 金额（分），金额可为 0，但总和应等于花费金额（由结算层提示而非硬拒） */
    amounts: z.record(z.string(), z.number().int().min(0)),
  }),
])

export const expenseSchema = z.object({
  id: z.string().min(1),
  date: dateSchema,
  category: expenseCategorySchema,
  title: z.string().min(1, '花费标题不能为空'),
  /** 整数分 */
  amountFen: z.number().int().min(0),
  payerId: z.string().min(1),
  split: expenseSplitSchema,
})

export const packingItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1, '行李条目名不能为空'),
  packed: z.boolean().default(false),
})

export const packingGroupSchema = z.object({
  group: z.string().min(1, '分组名不能为空'),
  items: z.array(packingItemSchema).default([]),
})

/** 模块显隐开关 */
export const enabledModulesSchema = z.object({
  expenses: z.boolean().default(true),
  notes: z.boolean().default(true),
})

/** 目的地类型：行李模板用 */
export const destTypeSchema = z.enum(['city', 'beach', 'mountain', 'generic'])

/** 分类预算：分类 → 整数分（部分分类可不设） */
export const categoryBudgetsSchema = z.record(expenseCategorySchema, z.number().int().min(0))

/** trip.v1 根 Schema */
export const tripSchema = z.object({
  format: z.literal('trip.v1'),
  /** Dexie 主键，导入 asNew / 复制时重新生成 */
  id: z.string().min(1).default(() => nanoid(10)),
  name: z.string().min(1, '旅行名称不能为空'),
  startDate: dateSchema,
  endDate: dateSchema,
  destType: destTypeSchema.default('generic'),
  destCity: z.string().default(''),
  /** 整数分 */
  totalBudgetFen: z.number().int().min(0).default(0),
  categoryBudgetsFen: z.preprocess(
    (v) => (v === undefined || v === null ? {} : v),
    categoryBudgetsSchema,
  ),
  members: z.array(memberSchema).default([]),
  days: z.array(tripDaySchema).default([]),
  expenses: z.array(expenseSchema).default([]),
  packing: z.array(packingGroupSchema).default([]),
  notes: z.string().default(''),
  enabledModules: enabledModulesSchema.default({ expenses: true, notes: true }),
})

export type Member = z.infer<typeof memberSchema>
export type MemberRole = z.infer<typeof memberRoleSchema>
export type TripItem = z.infer<typeof tripItemSchema>
export type ItemType = z.infer<typeof itemTypeSchema>
export type TripDay = z.infer<typeof tripDaySchema>
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>
export type ExpenseSplit = z.infer<typeof expenseSplitSchema>
export type Expense = z.infer<typeof expenseSchema>
export type PackingItem = z.infer<typeof packingItemSchema>
export type PackingGroup = z.infer<typeof packingGroupSchema>
export type EnabledModules = z.infer<typeof enabledModulesSchema>
export type DestType = z.infer<typeof destTypeSchema>
export type Trip = z.infer<typeof tripSchema>

/** 新建旅行的输入（不含 id 类字段） */
export interface NewTripInput {
  name: string
  startDate: string
  endDate: string
  destType: DestType
  destCity: string
  totalBudgetFen: number
}

/** 生成内部使用的新旅行对象（带 nanoid 的 id） */
export function createTrip(input: NewTripInput): Trip {
  return tripSchema.parse({
    format: 'trip.v1',
    ...input,
    members: [{ id: nanoid(8), name: '我', role: 'owner' }],
    days: buildDays(input.startDate, input.endDate),
    expenses: [],
    packing: [],
    notes: '',
    enabledModules: { expenses: true, notes: true },
  })
}

/** 按起止日期生成天列表 */
export function buildDays(startDate: string, endDate: string): TripDay[] {
  const days: TripDay[] = []
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  if (end < start) return days
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = formatDate(d)
    days.push(tripDaySchema.parse({ date, items: [] }))
  }
  return days
}

export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 校验并解析旅行 JSON（导入第一道 + 第二道防线入口） */
export function parseTripJson(text: string): Trip {
  const data: unknown = JSON.parse(text)
  return tripSchema.parse(data)
}

/** 校验未知对象是否为合法旅行 */
export function validateTrip(data: unknown): Trip {
  return tripSchema.parse(data)
}
