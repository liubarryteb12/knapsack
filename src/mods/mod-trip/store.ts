import { defineStore } from 'pinia'
import { db } from '../../db'
import {
  createTrip,
  tripSchema,
  type Trip,
  type NewTripInput,
} from './schema'
import { nanoid } from 'nanoid'
import { regenerateAllIds } from '../../utils/regenerateIds'
import { toTripSummary, type TripSummary } from './tripSummary'

function replaceSummary(summaries: TripSummary[], summary: TripSummary) {
  const idx = summaries.findIndex((item) => item.id === summary.id)
  if (idx >= 0) summaries.splice(idx, 1, summary)
  else summaries.push(summary)
}

/** 旅行列表 + 当前旅行 store：所有写入走 Dexie 持久化 */
export const useTripsStore = defineStore('trips', {
  state: () => ({
    /** 只缓存当前打开的完整聚合根，避免列表页把所有 days/expenses 常驻内存。 */
    trips: [] as Trip[],
    summaries: [] as TripSummary[],
    loaded: false,
  }),

  getters: {
    tripCount: (state) => state.summaries.length,
  },

  actions: {
    /** 兼容入口：现在只加载列表投影，完整行程由 getTrip 按需读取。 */
    async load() {
      await this.loadSummaries()
    },

    async loadSummaries() {
      const summaries: TripSummary[] = []
      await db.trips.each((trip) => {
        summaries.push(toTripSummary(trip))
      })
      this.summaries = summaries
      this.loaded = true
    },

    async addTrip(input: NewTripInput): Promise<Trip> {
      const trip = createTrip(input)
      await db.trips.put(trip)
      this.trips.push(trip)
      replaceSummary(this.summaries, toTripSummary(trip))
      return trip
    },

    async getTrip(id: string): Promise<Trip | undefined> {
      const local = this.trips.find((t) => t.id === id)
      if (local) return local
      const remote = await db.trips.get(id)
      if (remote) this.trips = [remote]
      return remote
    },

    /** 保存整个旅行对象（已在调用方做过业务修改），写前过 Zod 防线 */
    async saveTrip(trip: Trip) {
      const parsed = tripSchema.parse(trip)
      await db.trips.put(parsed)
      const idx = this.trips.findIndex((t) => t.id === parsed.id)
      if (idx >= 0) this.trips.splice(idx, 1, parsed)
      else this.trips.push(parsed)
      replaceSummary(this.summaries, toTripSummary(parsed))
      return parsed
    },

    async deleteTrip(id: string) {
      await db.trips.delete(id)
      this.trips = this.trips.filter((t) => t.id !== id)
      this.summaries = this.summaries.filter((t) => t.id !== id)
    },

    async duplicateTrip(id: string): Promise<Trip | undefined> {
      const source = await this.getTrip(id)
      if (!source) return undefined
      const copy: Trip = JSON.parse(JSON.stringify(source))
      copy.id = nanoid(10)
      copy.name = `${source.name}（副本）`
      regenerateAllIds(copy)
      await db.trips.put(copy)
      this.trips.push(copy)
      replaceSummary(this.summaries, toTripSummary(copy))
      return copy
    },

    /** 导入：overwrite 用相同 id 覆盖；asNew 生成全新 id 并重挂所有引用 */
    async importTrip(trip: Trip, mode: 'overwrite' | 'asNew'): Promise<Trip> {
      const target: Trip = JSON.parse(JSON.stringify(trip))
      if (mode === 'asNew') {
        target.id = nanoid(10)
        regenerateAllIds(target)
      }
      const parsed = tripSchema.parse(target)
      await db.trips.put(parsed)
      const idx = this.trips.findIndex((t) => t.id === parsed.id)
      if (idx >= 0) this.trips.splice(idx, 1, parsed)
      else this.trips.push(parsed)
      replaceSummary(this.summaries, toTripSummary(parsed))
      return parsed
    },

    /** 设置页只改模块显隐，不把完整行程长期留在列表内存里。 */
    async setTripModule(
      id: string,
      key: keyof TripSummary['enabledModules'],
      value: boolean,
    ): Promise<boolean> {
      const summary = this.summaries.find((trip) => trip.id === id)
      const previousSummaryValue = summary?.enabledModules[key]
      if (summary) summary.enabledModules[key] = value

      const trip = await this.getTrip(id)
      if (!trip) {
        if (summary && previousSummaryValue !== undefined) {
          summary.enabledModules[key] = previousSummaryValue
        }
        return false
      }

      const previousTripValue = trip.enabledModules[key]
      trip.enabledModules[key] = value
      try {
        await this.saveTrip(trip)
        return true
      } catch {
        trip.enabledModules[key] = previousTripValue
        if (summary && previousSummaryValue !== undefined) {
          summary.enabledModules[key] = previousSummaryValue
        }
        return false
      }
    },
  },
})
