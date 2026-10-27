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

export const dailyTaskStatusSchema = z.enum(['TODO', 'DONE', 'ROLLED_OVER'])

export function timeToMinute(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return (hour ?? 0) * 60 + (minute ?? 0)
}

export function minuteToTime(value: number): string {
  const normalized = ((value % (24 * 60)) + 24 * 60) % (24 * 60)
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function normalizeEndMinute(startMinute: number | null, endMinute: number | null): number | null {
  if (startMinute === null || endMinute === null) return endMinute
  return endMinute < startMinute ? endMinute + 24 * 60 : endMinute
}

export const dailyTaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(1, '任务标题不能为空'),
    startTime: dailyTimeSchema.default(null),
    endTime: dailyTimeSchema.default(null),
    startMinute: z.number().int().min(0).max(1440).nullable().default(null),
    endMinute: z.number().int().min(0).max(1620).nullable().default(null),
    done: z.boolean().default(false),
    status: dailyTaskStatusSchema.default('TODO'),
    originTaskId: z.string().min(1).nullable().default(null),
    rolloverCount: z.number().int().min(0).default(0),
    note: z.string().default(''),
    createdAt: z.number().int().min(0),
    updatedAt: z.number().int().min(0),
  })
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
export type DailyTaskStatus = z.infer<typeof dailyTaskStatusSchema>
export type DailyReview = z.infer<typeof dailyReviewSchema>
export type DailyDay = z.infer<typeof dailyDaySchema>

export function newDailyTask(
  input: { title: string; startTime?: string | null; endTime?: string | null; note?: string },
  now = Date.now(),
): DailyTask {
  const startMinute = input.startTime ? timeToMinute(input.startTime) : null
  const rawEndMinute = input.endTime ? timeToMinute(input.endTime) : null
  const endMinute = normalizeEndMinute(startMinute, rawEndMinute)
  return dailyTaskSchema.parse({
    id: nanoid(10),
    title: input.title,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    startMinute,
    endMinute,
    done: false,
    status: 'TODO',
    originTaskId: null,
    rolloverCount: 0,
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
  const parsed = dailyDaySchema.parse(value)
  return {
    ...parsed,
    tasks: parsed.tasks.map((task) => {
      const startMinute = task.startMinute ??
        (task.startTime ? timeToMinute(task.startTime) : null)
      const rawEndMinute = task.endMinute ??
        (task.endTime ? timeToMinute(task.endTime) : null)
      return {
        ...task,
        startMinute,
        endMinute: normalizeEndMinute(startMinute, rawEndMinute),
        status: task.done ? 'DONE' : task.status === 'DONE' ? 'TODO' : task.status,
      }
    }),
  }
}
