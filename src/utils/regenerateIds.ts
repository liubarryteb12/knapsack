import type { Trip } from '../schema/trip'
import { nanoid } from 'nanoid'

/**
 * 深拷贝后重建所有 id，并同步更新所有交叉引用：
 * 成员 id（payerId/memberIds/split.amounts 的键）、花费 id（linkedExpenseId）。
 * 否则副本/另存的旅行会出现分摊指向幽灵成员的脏数据。
 */
export function regenerateAllIds(trip: Trip): void {
  // 0. 旅行自身 id（复制/另存为新时调用方不一定要先设）
  trip.id = nanoid(10)

  // 1. 成员 id 映射（保持 owner 等角色不变）
  const memberMap = new Map<string, string>()
  for (const m of trip.members) {
    const newId = nanoid(8)
    memberMap.set(m.id, newId)
    m.id = newId
  }

  // 2. 花费：重建 id + 更新成员引用
  const expenseMap = new Map<string, string>()
  for (const e of trip.expenses) {
    const newId = nanoid(10)
    expenseMap.set(e.id, newId)
    e.id = newId
    e.payerId = memberMap.get(e.payerId) ?? e.payerId
    if (e.split.mode === 'equal' || e.split.mode === 'shares') {
      e.split.memberIds = e.split.memberIds.map((id) => memberMap.get(id) ?? id)
      if (e.split.mode === 'shares') {
        // shares 与 memberIds 一一对应，memberIds 已按序映射，shares 无需变
      }
    } else {
      const amounts: Record<string, number> = {}
      for (const [id, fen] of Object.entries(e.split.amounts)) {
        amounts[memberMap.get(id) ?? id] = fen
      }
      e.split.amounts = amounts
    }
  }

  // 3. 行程条目：重建 id + 更新花费引用
  for (const day of trip.days) {
    for (const item of day.items) {
      item.id = nanoid(10)
      if (item.linkedExpenseId !== null) {
        item.linkedExpenseId = expenseMap.get(item.linkedExpenseId) ?? null
      }
    }
  }

  // 4. 行李条目 id
  for (const g of trip.packing) {
    for (const item of g.items) item.id = nanoid(10)
  }
}
