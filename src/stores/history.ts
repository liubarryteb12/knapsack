import { defineStore } from 'pinia'
import type { Trip } from '../schema/trip'
import { useTripsStore } from './trips'

interface Snapshot {
  tripId: string
  data: string // JSON 快照
  label: string
}

/**
 * 撤销栈：保存旅行 JSON 快照，最多 50 步（规划要求至少 20 步）。
 * undo 恢复上一个快照，redo 恢复被撤销的。
 */
export const useHistoryStore = defineStore('history', {
  state: () => ({
    undoStack: [] as Snapshot[],
    redoStack: [] as Snapshot[],
    maxLen: 50,
  }),

  actions: {
    /** 在每次修改前调用：压入当前状态快照 */
    push(trip: Trip, label: string) {
      this.undoStack.push({
        tripId: trip.id,
        data: JSON.stringify(trip),
        label,
      })
      if (this.undoStack.length > this.maxLen) {
        this.undoStack.shift()
      }
      this.redoStack = []
    },

    canUndo(tripId: string): boolean {
      return this.undoStack.some((s) => s.tripId === tripId)
    },

    canRedo(tripId: string): boolean {
      return this.redoStack.some((s) => s.tripId === tripId)
    },

    async undo(tripId: string): Promise<string | null> {
      const idx = findLastIndex(this.undoStack, (s) => s.tripId === tripId)
      if (idx < 0) return null
      const snapshot = this.undoStack.splice(idx, 1)[0]!
      const tripsStore = useTripsStore()

      // redo 要恢复的是「undo 之前那一版」，所以必须先取当前状态再回退。
      // 旧实现把 undo 弹出的快照本身推入 redoStack——那个快照就是 undo 后的
      // 当前状态，redo 时再写回它等于什么都没做，用户撤销的编辑永久找不回来。
      const current = tripsStore.trips.find((t) => t.id === tripId)
      if (current) {
        this.redoStack.push({
          tripId,
          data: JSON.stringify(current),
          label: snapshot.label,
        })
      }

      await tripsStore.saveTrip(JSON.parse(snapshot.data))
      return snapshot.label
    },

    async redo(tripId: string): Promise<string | null> {
      const idx = findLastIndex(this.redoStack, (s) => s.tripId === tripId)
      if (idx < 0) return null
      const snapshot = this.redoStack.splice(idx, 1)[0]!
      const tripsStore = useTripsStore()

      // 对称处理：把当前状态压回 undoStack，用户才能再次 undo
      const current = tripsStore.trips.find((t) => t.id === tripId)
      if (current) {
        this.undoStack.push({
          tripId,
          data: JSON.stringify(current),
          label: snapshot.label,
        })
      }

      await tripsStore.saveTrip(JSON.parse(snapshot.data))
      return snapshot.label
    },
  },
})

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return i
  }
  return -1
}
