import { defineStore } from 'pinia'
import { db } from '../../db'
import { UndoStack } from '../../engines/timeline-engine/undo-stack'
import { addDays, todayStr } from '../../utils/date'
import {
  createDailyDay,
  dailyDateSchema,
  dailyDaySchema,
  normalizeEndMinute,
  newDailyTask,
  minuteToTime,
  parseDailyDay,
  timeToMinute,
  type DailyDay,
  type DailyReview,
  type DailyTask,
} from './schema'
import { rolloverIncompleteTasks } from './rollover'

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveQueue: Promise<boolean> = Promise.resolve(true)
let pendingSaves = 0

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

interface DailySnapshot {
  day: DailyDay
  rolloverSource: DailyDay | null
}

export const useDailyStore = defineStore('daily', {
  state: () => ({
    currentDate: todayStr(),
    day: null as DailyDay | null,
    loading: false,
    saving: false,
    lastSavedAt: null as number | null,
    error: '',
    history: new UndoStack<DailySnapshot>(),
    currentRolloverSource: null as DailyDay | null,
    rolloverAvailable: 0,
    rolloverSourceDate: null as string | null,
  }),

  getters: {
    sortedTasks(state): DailyTask[] {
      return [...(state.day?.tasks ?? [])].sort((a, b) => {
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
        if (a.startTime) return -1
        if (b.startTime) return 1
        return a.createdAt - b.createdAt
      })
    },
    completedCount(state): number {
      return state.day?.tasks.filter((t) => t.done).length ?? 0
    },
    canUndo(state): boolean {
      return state.history.canUndo()
    },
    canRedo(state): boolean {
      return state.history.canRedo()
    },
  },

  actions: {
    async load(date = todayStr()): Promise<void> {
      const validDate = dailyDateSchema.parse(date)
      // 即使还是同一天，也先保存待写入的自动保存内容，避免“点今天”把未落盘备忘覆盖掉。
      if (this.day) {
        const saved = await this.flushSave()
        if (!saved) {
          this.error = '当前日期的自动保存失败，已取消切换，请检查存储空间后重试'
          return
        }
      }

      this.loading = true
      this.error = ''
      try {
        const stored = await db.dailyDays.get(validDate)
        this.currentDate = validDate
        this.day = stored ? parseDailyDay(stored) : createDailyDay(validDate)
        this.lastSavedAt = stored?.updatedAt ?? null
        this.history.clear()
        this.currentRolloverSource = null
        await this.scanRollover()
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },

    async save(): Promise<boolean> {
      if (!this.day) return false
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const now = Date.now()
      const snapshot = dailyDaySchema.parse(plain({ ...this.day, updatedAt: now }))
      const snapshotDate = snapshot.date
      pendingSaves++
      this.saving = true
      this.error = ''
      const job = saveQueue.then(async () => {
        try {
          await db.dailyDays.put(snapshot)
          if (this.day?.date === snapshotDate) {
            this.day.updatedAt = snapshot.updatedAt
            this.lastSavedAt = now
          }
          return true
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          return false
        } finally {
          pendingSaves--
          this.saving = pendingSaves > 0
        }
      })
      saveQueue = job.catch(() => false)
      return job
    },

    scheduleSave(delay = 300): void {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        void this.save()
      }, delay)
    },

    async flushSave(): Promise<boolean> {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      if (!this.day) return true
      return this.save()
    },

    async addTask(input: {
      title: string
      startTime?: string | null
      endTime?: string | null
      note?: string
    }): Promise<DailyTask | null> {
      if (!this.day) await this.load(this.currentDate)
      if (!this.day) return null
      const task = newDailyTask(input)
      this.recordHistory()
      this.day.tasks.push(task)
      return (await this.save()) ? task : null
    },

    async updateTask(id: string, patch: Partial<Pick<DailyTask, 'title' | 'startTime' | 'endTime' | 'note' | 'done'>>): Promise<boolean> {
      const task = this.day?.tasks.find((t) => t.id === id)
      if (!task) return false
      this.recordHistory()
      Object.assign(task, patch, { updatedAt: Date.now() })
      if ('startTime' in patch) {
        task.startMinute = patch.startTime ? timeToMinute(patch.startTime) : null
      }
      if ('endTime' in patch) {
        const rawEndMinute = patch.endTime ? timeToMinute(patch.endTime) : null
        task.endMinute = normalizeEndMinute(task.startMinute, rawEndMinute)
      }
      if ('done' in patch) {
        task.status = patch.done ? 'DONE' : 'TODO'
      }
      return this.save()
    },

    async toggleTask(id: string): Promise<boolean> {
      const task = this.day?.tasks.find((t) => t.id === id)
      if (!task) return false
      this.recordHistory()
      task.done = !task.done
      task.status = task.done ? 'DONE' : 'TODO'
      task.updatedAt = Date.now()
      return this.save()
    },

    async removeTask(id: string): Promise<boolean> {
      if (!this.day) return false
      const found = this.day.tasks.some((task) => task.id === id)
      if (!found) return false
      this.recordHistory()
      this.day.tasks = this.day.tasks.filter((t) => t.id !== id)
      return this.save()
    },

    async moveTaskTime(id: string, startMinute: number, endMinute: number): Promise<boolean> {
      const task = this.day?.tasks.find((item) => item.id === id)
      if (!task) return false
      if (
        !Number.isInteger(startMinute) ||
        !Number.isInteger(endMinute) ||
        startMinute < 0 ||
        startMinute > 1440 ||
        endMinute <= startMinute ||
        endMinute > 1620
      ) {
        this.error = '时间块范围无效'
        return false
      }
      this.recordHistory()
      task.startMinute = startMinute
      task.endMinute = endMinute
      task.startTime = minuteToTime(startMinute)
      task.endTime = minuteToTime(endMinute)
      task.updatedAt = Date.now()
      return this.save()
    },

    setMemo(value: string): void {
      if (!this.day) return
      this.day.memo = value
      this.scheduleSave()
    },

    setReview(field: keyof DailyReview, value: string): void {
      if (!this.day) return
      this.day.review[field] = value
      this.scheduleSave()
    },

    recordHistory(): void {
      if (!this.day) return
      this.history.push({
        day: plain(this.day),
        rolloverSource: this.currentRolloverSource
          ? plain(this.currentRolloverSource)
          : null,
      })
    },

    currentSnapshot(): DailySnapshot | null {
      if (!this.day) return null
      return {
        day: plain(this.day),
        rolloverSource: this.currentRolloverSource
          ? plain(this.currentRolloverSource)
          : null,
      }
    },

    async applyHistorySnapshot(snapshot: DailySnapshot): Promise<void> {
      this.day = plain(dailyDaySchema.parse(snapshot.day))
      const rolloverSource = snapshot.rolloverSource
        ? plain(dailyDaySchema.parse(snapshot.rolloverSource))
        : null
      this.currentRolloverSource = rolloverSource
      if (rolloverSource) {
        await db.dailyDays.put(rolloverSource)
      }
      await this.save()
      await this.scanRollover()
    },

    async undo(): Promise<boolean> {
      const current = this.currentSnapshot()
      if (!current) return false
      const previous = this.history.undo(current)
      if (!previous) return false
      await this.applyHistorySnapshot(previous)
      return true
    },

    async redo(): Promise<boolean> {
      const current = this.currentSnapshot()
      if (!current) return false
      const next = this.history.redo(current)
      if (!next) return false
      await this.applyHistorySnapshot(next)
      return true
    },

    async scanRollover(): Promise<void> {
      if (!this.day) {
        this.rolloverAvailable = 0
        this.rolloverSourceDate = null
        return
      }
      const sourceDate = addDays(this.currentDate, -1)
      const source = await db.dailyDays.get(sourceDate)
      if (!source) {
        this.rolloverAvailable = 0
        this.rolloverSourceDate = null
        return
      }
      const preview = rolloverIncompleteTasks(
        parseDailyDay(source),
        this.day,
      )
      this.rolloverAvailable = preview.moved
      this.rolloverSourceDate = preview.moved > 0 ? sourceDate : null
    },

    async rolloverFromPrevious(): Promise<number> {
      if (!this.day) return 0
      const sourceDate = addDays(this.currentDate, -1)
      const storedSource = await db.dailyDays.get(sourceDate)
      if (!storedSource) return 0
      const before = this.currentSnapshot()
      if (!before) return 0
      const result = rolloverIncompleteTasks(
        parseDailyDay(storedSource),
        this.day,
      )
      if (result.moved === 0) {
        this.rolloverAvailable = 0
        this.rolloverSourceDate = null
        return 0
      }

      const historyBefore: DailySnapshot = {
        ...before,
        rolloverSource: parseDailyDay(storedSource),
      }
      await db.transaction('rw', db.dailyDays, async () => {
        await db.dailyDays.put(result.sourceDay)
        await db.dailyDays.put(result.targetDay)
      })
      this.history.push(historyBefore)
      this.day = result.targetDay
      this.currentRolloverSource = result.sourceDay
      this.lastSavedAt = result.targetDay.updatedAt
      this.rolloverAvailable = 0
      this.rolloverSourceDate = null
      return result.moved
    },
  },
})
