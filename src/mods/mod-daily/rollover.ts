import { nanoid } from 'nanoid'
import {
  dailyDaySchema,
  normalizeEndMinute,
  type DailyDay,
  type DailyTask,
} from './schema'

export interface RolloverResult {
  sourceDay: DailyDay
  targetDay: DailyDay
  moved: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function rolloverTask(task: DailyTask, now: number): DailyTask {
  return {
    ...clone(task),
    id: nanoid(10),
    startMinute: task.startMinute,
    endMinute: normalizeEndMinute(task.startMinute, task.endMinute),
    done: false,
    status: 'TODO',
    originTaskId: task.originTaskId ?? task.id,
    rolloverCount: task.rolloverCount + 1,
    createdAt: now,
    updatedAt: now,
  }
}

/** Move incomplete tasks without mutating or deleting the source history. */
export function rolloverIncompleteTasks(
  sourceDay: DailyDay,
  targetDay: DailyDay,
  now = Date.now(),
): RolloverResult {
  if (sourceDay.date >= targetDay.date) {
    throw new Error('只能从较早日期顺延到较晚日期')
  }

  const existingOrigins = new Set(
    targetDay.tasks
      .map((task) => task.originTaskId)
      .filter((id): id is string => id !== null),
  )
  const movable = sourceDay.tasks.filter(
    (task) =>
      !task.done &&
      task.status !== 'ROLLED_OVER' &&
      !existingOrigins.has(task.originTaskId ?? task.id),
  )
  if (movable.length === 0) {
    return { sourceDay, targetDay, moved: 0 }
  }

  const movableIds = new Set(movable.map((task) => task.id))
  const nextSource = dailyDaySchema.parse({
    ...clone(sourceDay),
    tasks: sourceDay.tasks.map((task) =>
      movableIds.has(task.id)
        ? { ...task, status: 'ROLLED_OVER', updatedAt: now }
        : task,
    ),
    updatedAt: now,
  })
  const nextTarget = dailyDaySchema.parse({
    ...clone(targetDay),
    tasks: [...targetDay.tasks, ...movable.map((task) => rolloverTask(task, now))],
    updatedAt: now,
  })
  return { sourceDay: nextSource, targetDay: nextTarget, moved: movable.length }
}
