export interface TimeBlock {
  id: string
  startMinute: number
  endMinute: number
}

export interface TimeBlockConflict {
  leftId: string
  rightId: string
  overlapStart: number
  overlapEnd: number
}

function validateBlock(block: TimeBlock): void {
  if (!Number.isInteger(block.startMinute) || block.startMinute < 0 || block.startMinute > 1440) {
    throw new Error(`时间块开始分钟无效：${block.id}`)
  }
  if (!Number.isInteger(block.endMinute) || block.endMinute > 1620) {
    throw new Error(`时间块结束分钟无效：${block.id}`)
  }
  if (block.endMinute <= block.startMinute) {
    throw new Error(`时间块结束必须晚于开始：${block.id}`)
  }
}

export function sortTimeBlocks<T extends TimeBlock>(blocks: readonly T[]): T[] {
  for (const block of blocks) validateBlock(block)
  return [...blocks].sort(
    (left, right) =>
      left.startMinute - right.startMinute ||
      left.endMinute - right.endMinute ||
      left.id.localeCompare(right.id),
  )
}

export function findTimeBlockConflicts(blocks: readonly TimeBlock[]): TimeBlockConflict[] {
  const sorted = sortTimeBlocks(blocks)
  const conflicts: TimeBlockConflict[] = []
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex++) {
    const left = sorted[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex++) {
      const right = sorted[rightIndex]!
      if (right.startMinute >= left.endMinute) break
      const overlapStart = Math.max(left.startMinute, right.startMinute)
      const overlapEnd = Math.min(left.endMinute, right.endMinute)
      if (overlapEnd > overlapStart) {
        conflicts.push({
          leftId: left.id,
          rightId: right.id,
          overlapStart,
          overlapEnd,
        })
      }
    }
  }
  return conflicts
}
