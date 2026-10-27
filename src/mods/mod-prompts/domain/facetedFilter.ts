import type { PromptItem, PromptModality } from '../schema'

export const PROMPT_SORT_MODES = ['favorite', 'recent', 'usage', 'title'] as const
export type PromptSortMode = (typeof PROMPT_SORT_MODES)[number]

type FacetSelection<T extends string> = T | readonly T[]

export interface PromptFilterCriteria {
  modality?: FacetSelection<PromptModality>
  targetTool?: FacetSelection<string>
  domainTheme?: FacetSelection<string>
  styleTechnique?: FacetSelection<string>
  keyword?: string
  sortBy?: PromptSortMode
}

export interface PromptFacetCounts {
  modality: Record<PromptModality, number>
  targetTool: Record<string, number>
  domainTheme: Record<string, number>
  styleTechnique: Record<string, number>
}

export interface PromptFilterResult {
  items: PromptItem[]
  facets: PromptFacetCounts
}

const titleCollator = new Intl.Collator('zh-CN')

function normalize(value: string) {
  return value.trim().toLocaleLowerCase()
}

function toSelectionSet<T extends string>(selection: FacetSelection<T> | undefined) {
  if (selection === undefined) return null

  const values = typeof selection === 'string' ? [selection] : selection
  if (values.length === 0) return null

  return new Set(values.map(normalize))
}

function intersects(values: readonly string[], selection: ReadonlySet<string> | null) {
  return selection === null || values.some((value) => selection.has(normalize(value)))
}

function payloadContainsText(payload: object, keyword: string) {
  const pending: unknown[] = [payload]

  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'string') {
      if (normalize(value).includes(keyword)) return true
      continue
    }

    if (Array.isArray(value)) {
      pending.push(...value)
      continue
    }

    if (value !== null && typeof value === 'object') {
      pending.push(...Object.values(value))
    }
  }

  return false
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1
}

function countFacets(items: readonly PromptItem[]): PromptFacetCounts {
  const facets: PromptFacetCounts = {
    modality: {
      WORK_LLM: 0,
      IMAGE_GEN: 0,
      VIDEO_GEN: 0,
    },
    targetTool: {},
    domainTheme: {},
    styleTechnique: {},
  }

  for (const item of items) {
    facets.modality[item.modality]++
    for (const value of item.facets.targetTool) increment(facets.targetTool, value)
    for (const value of item.facets.domainTheme) increment(facets.domainTheme, value)
    for (const value of item.facets.styleTechnique) increment(facets.styleTechnique, value)
  }

  return facets
}

function compareTitle(left: PromptItem, right: PromptItem) {
  return titleCollator.compare(left.title, right.title) || left.id.localeCompare(right.id)
}

function sortItems(items: PromptItem[], sortBy: PromptSortMode) {
  switch (sortBy) {
    case 'recent':
      return items.sort((left, right) => right.updatedAt - left.updatedAt || compareTitle(left, right))
    case 'usage':
      return items.sort(
        (left, right) =>
          right.usageCount - left.usageCount ||
          right.updatedAt - left.updatedAt ||
          compareTitle(left, right),
      )
    case 'title':
      return items.sort(compareTitle)
    case 'favorite':
    default:
      return items.sort(
        (left, right) =>
          Number(right.isFavorite) - Number(left.isFavorite) ||
          right.updatedAt - left.updatedAt ||
          compareTitle(left, right),
      )
  }
}

/**
 * Filters prompt items with OR inside each facet dimension and AND across dimensions.
 * Facet counts describe the items that survive the active criteria.
 */
export function filterPromptItems(
  items: readonly PromptItem[],
  criteria: PromptFilterCriteria = {},
): PromptFilterResult {
  const modality = toSelectionSet(criteria.modality)
  const targetTool = toSelectionSet(criteria.targetTool)
  const domainTheme = toSelectionSet(criteria.domainTheme)
  const styleTechnique = toSelectionSet(criteria.styleTechnique)
  const keyword = criteria.keyword?.trim() ? normalize(criteria.keyword) : ''

  const filtered = items.filter((item) => {
    if (modality !== null && !modality.has(normalize(item.modality))) return false
    if (!intersects(item.facets.targetTool, targetTool)) return false
    if (!intersects(item.facets.domainTheme, domainTheme)) return false
    if (!intersects(item.facets.styleTechnique, styleTechnique)) return false

    if (
      keyword.length > 0 &&
      !normalize(item.title).includes(keyword) &&
      !payloadContainsText(item.payload, keyword)
    ) {
      return false
    }

    return true
  })

  const facets = countFacets(filtered)
  const sorted = sortItems(filtered, criteria.sortBy ?? 'favorite')
  return { items: sorted, facets }
}
