/** mod-daily 数据契约：每天一条记录，数据只存在本机 IndexedDB。 */
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { toDateStr } from '../../utils/date'

export const DAILY_FORMAT = 'daily-day.v1'

export const dailyDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 yyyy-MM-dd')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00`)
    return !Number.isNaN(parsed.getTime()) && toDateStr(parsed) === value
  }, '日期不存在')

export const dailyTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm')
  .nullable()

export const dailyTaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(1, '任务标题不能为空'),
    startTime: dailyTimeSchema.default(null),
    endTime: dailyTimeSchema.default(null),
    done: z.boolean().default(false),
    note: z.string().default(''),
    createdAt: z.number().int().min(0),
    updatedAt: z.number().int().min(0),
  })
  .refine(
    (task) => !task.startTime || !task.endTime || task.endTime >= task.startTime,
    { message: '结束时间不能早于开始时间' },
  )
  .refine((task) => !task.endTime || !!task.startTime, {
    message: '设置结束时间时必须填写开始时间',
  })

export const dailyReviewSchema = z.object({
  wins: z.string().default(''),
  blockers: z.string().default(''),
  tomorrow: z.string().default(''),
})

export const dailyDaySchema = z.object({
  format: z.literal(DAILY_FORMAT),
  date: dailyDateSchema,
  tasks: z.array(dailyTaskSchema).default([]),
  memo: z.string().default(''),
  review: dailyReviewSchema.default({ wins: '', blockers: '', tomorrow: '' }),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})

export type DailyTask = z.infer<typeof dailyTaskSchema>
export type DailyReview = z.infer<typeof dailyReviewSchema>
export type DailyDay = z.infer<typeof dailyDaySchema>

export function newDailyTask(
  input: { title: string; startTime?: string | null; endTime?: string | null; note?: string },
  now = Date.now(),
): DailyTask {
  return dailyTaskSchema.parse({
    id: nanoid(10),
    title: input.title,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    done: false,
    note: input.note ?? '',
    createdAt: now,
    updatedAt: now,
  })
}

export function createDailyDay(date: string, now = Date.now()): DailyDay {
  return dailyDaySchema.parse({
    format: DAILY_FORMAT,
    date,
    tasks: [],
    memo: '',
    review: { wins: '', blockers: '', tomorrow: '' },
    createdAt: now,
    updatedAt: now,
  })
}

export function parseDailyDay(value: unknown): DailyDay {
  return dailyDaySchema.parse(value)
}
