import { shallowReactive } from 'vue'
import type {
  ModId,
  ModSlotContribution,
  ModSlotName,
} from './modRegistry'

export interface RegisteredSlotContribution extends ModSlotContribution {
  modId: ModId
}

/** Host-owned registry for named UI extension slots. */
export class SlotManager {
  private readonly items = shallowReactive<RegisteredSlotContribution[]>([])

  contribute(modId: ModId, contributions: readonly ModSlotContribution[] | undefined): void {
    this.remove(modId)
    if (!contributions) return
    this.items.push(...contributions.map((item) => ({ ...item, modId })))
  }

  remove(modId: ModId): void {
    for (let index = this.items.length - 1; index >= 0; index--) {
      if (this.items[index]?.modId === modId) this.items.splice(index, 1)
    }
  }

  resolve(targetSlot: ModSlotName): RegisteredSlotContribution[] {
    return this.items
      .filter((item) => item.targetSlot === targetSlot)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.modId.localeCompare(b.modId))
  }
}
