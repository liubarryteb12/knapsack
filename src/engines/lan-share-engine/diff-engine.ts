/**
 * Generic JSON diff for review payloads. Digest signing stays in digest-signer.
 */

export type JsonDiffOp = 'add' | 'remove' | 'change'
export type JsonDiffPath = Array<string | number>
export type JsonDiffValueKind =
  | 'numeric'
  | 'text'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'
  | 'mixed'
  | 'other'

export interface JsonDiffEntry {
  op: JsonDiffOp
  path: JsonDiffPath
  before?: unknown
  after?: unknown
  valueKind: JsonDiffValueKind
}

function classify(value: unknown): JsonDiffValueKind {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? 'numeric' : 'other'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return 'other'
}

function combinedKind(before: unknown, after: unknown): JsonDiffValueKind {
  const left = classify(before)
  return left === classify(after) ? left : 'mixed'
}

function diffLeaf(before: unknown, after: unknown, path: JsonDiffPath): JsonDiffEntry[] {
  if (Object.is(before, after)) return []
  return [{
    op: 'change',
    path,
    before,
    after,
    valueKind: combinedKind(before, after),
  }]
}

function diffNode(before: unknown, after: unknown, path: JsonDiffPath): JsonDiffEntry[] {
  if (Object.is(before, after)) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    const entries: JsonDiffEntry[] = []
    const commonLength = Math.min(before.length, after.length)
    for (let index = 0; index < commonLength; index++) {
      entries.push(...diffNode(before[index], after[index], [...path, index]))
    }
    for (let index = commonLength; index < after.length; index++) {
      entries.push({
        op: 'add',
        path: [...path, index],
        after: after[index],
        valueKind: classify(after[index]),
      })
    }
    for (let index = after.length; index < before.length; index++) {
      entries.push({
        op: 'remove',
        path: [...path, index],
        before: before[index],
        valueKind: classify(before[index]),
      })
    }
    return entries
  }
  const beforeIsObject = typeof before === 'object' && before !== null && !Array.isArray(before)
  const afterIsObject = typeof after === 'object' && after !== null && !Array.isArray(after)
  if (beforeIsObject && afterIsObject) {
    const left = before as Record<string, unknown>
    const right = after as Record<string, unknown>
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    const entries: JsonDiffEntry[] = []
    for (const key of keys) {
      if (key in left && key in right) {
        entries.push(...diffNode(left[key], right[key], [...path, key]))
      } else if (key in left) {
        entries.push({
          op: 'remove',
          path: [...path, key],
          before: left[key],
          valueKind: classify(left[key]),
        })
      } else {
        entries.push({
          op: 'add',
          path: [...path, key],
          after: right[key],
          valueKind: classify(right[key]),
        })
      }
    }
    return entries
  }
  return diffLeaf(before, after, path)
}

export function diffJson(before: unknown, after: unknown): JsonDiffEntry[] {
  return diffNode(before, after, [])
}
