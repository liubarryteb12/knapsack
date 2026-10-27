/** 条目类型 / 花费分类的文案元信息（图标统一在 icons.ts） */

export const itemLabel: Record<string, string> = {
  transport: '交通',
  stay: '住宿',
  food: '餐饮',
  play: '游玩',
  other: '其他',
}

export const itemTypeOptions = [
  { label: '交通', value: 'transport' },
  { label: '住宿', value: 'stay' },
  { label: '餐饮', value: 'food' },
  { label: '游玩', value: 'play' },
  { label: '其他', value: 'other' },
]

export const expenseCategoryLabel: Record<string, string> = {
  transport: '交通',
  stay: '住宿',
  food: '餐饮',
  play: '游玩',
  other: '其他',
}

export const expenseCategoryOptions = itemTypeOptions
