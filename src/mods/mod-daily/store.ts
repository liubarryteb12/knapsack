import { defineStore } from 'pinia'
import { db } from '../../db'
import { todayStr } from '../../utils/date'
import {
  createDailyDay,
  dailyDateSchema,
  dailyDaySchema,
  newDailyTask,
  type DailyDay,
  type DailyReview,
  type DailyTask,
} from './schema'

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveQueue: Promise<boolean> = Promise.resolve(true)
let pendingSaves = 0

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useDailyStore = defineStore('daily', {
  state: () => ({
    currentDate: todayStr(),
    day: null as DailyDay | null,
    loading: false,
    saving: false,
    lastSavedAt: null as number | null,
    error: '',
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
        this.day = stored ? dailyDaySchema.parse(stored) : createDailyDay(validDate)
        this.lastSavedAt = stored?.updatedAt ?? null
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

    scheduleSave(delay = 500): void {
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
      this.day.tasks.push(task)
      return (await this.save()) ? task : null
    },

    async updateTask(id: string, patch: Partial<Pick<DailyTask, 'title' | 'startTime' | 'endTime' | 'note' | 'done'>>): Promise<boolean> {
      const task = this.day?.tasks.find((t) => t.id === id)
      if (!task) return false
      Object.assign(task, patch, { updatedAt: Date.now() })
      return this.save()
    },

    async toggleTask(id: string): Promise<boolean> {
      const task = this.day?.tasks.find((t) => t.id === id)
      if (!task) return false
      task.done = !task.done
      task.updatedAt = Date.now()
      return this.save()
    },

    async removeTask(id: string): Promise<boolean> {
      if (!this.day) return false
      const before = this.day.tasks.length
      this.day.tasks = this.day.tasks.filter((t) => t.id !== id)
      if (this.day.tasks.length === before) return false
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
  },
})
