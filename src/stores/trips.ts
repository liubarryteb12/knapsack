import { defineStore } from 'pinia'
import { db } from '../db'
import {
  createTrip,
  tripSchema,
  type Trip,
  type NewTripInput,
} from '../schema/trip'
import { nanoid } from 'nanoid'

/** 旅行列表 + 当前旅行 store：所有写入走 Dexie 持久化 */
export const useTripsStore = defineStore('trips', {
  state: () => ({
    trips: [] as Trip[],
    loaded: false,
  }),

  getters: {
    tripCount: (state) => state.trips.length,
  },

  actions: {
    async load() {
      this.trips = await db.trips.toArray()
      this.loaded = true
    },

    async addTrip(input: NewTripInput): Promise<Trip> {
      const trip = createTrip(input)
      await db.trips.put(trip)
      this.trips.push(trip)
      return trip
    },

    async getTrip(id: string): Promise<Trip | undefined> {
      const local = this.trips.find((t) => t.id === id)
      if (local) return local
      const remote = await db.trips.get(id)
      if (remote) this.trips.push(remote)
      return remote
    },

    /** 保存整个旅行对象（已在调用方做过业务修改） */
    async saveTrip(trip: Trip) {
      const parsed = tripSchema.parse(trip)
      await db.trips.put(parsed)
      const idx = this.trips.findIndex((t) => t.id === parsed.id)
      if (idx >= 0) this.trips.splice(idx, 1, parsed)
      else this.trips.push(parsed)
      return parsed
    },

    async deleteTrip(id: string) {
      await db.trips.delete(id)
      this.trips = this.trips.filter((t) => t.id !== id)
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
      return copy
    },

    /** 导入：overwrite 用相同 id 覆盖；asNew 生成全新 id */
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
      return parsed
    },
  },
})

/** 深拷贝后重建所有 id，避免副本与原旅行冲突 */
function regenerateAllIds(trip: Trip) {
  for (const day of trip.days) {
    for (const item of day.items) item.id = nanoid(10)
  }
  for (const e of trip.expenses) e.id = nanoid(10)
  for (const g of trip.packing) {
    for (const item of g.items) item.id = nanoid(10)
  }
  for (const m of trip.members) m.id = nanoid(8)
}
