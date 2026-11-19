export const CUSTOM_FACET_OPTION = '__custom__'

export const PROMPT_FACET_PRESETS = {
  targetTool: [
    '工作协作',
    '写作表达',
    '编程开发',
    '学习研究',
    '数据分析',
    '内容创作',
    '商业运营',
    '项目管理',
    '生活决策',
    '图像生成',
    '视频生成',
  ],
  domainTheme: [
    '提示词',
    '工作规范',
    '流程 SOP',
    '模板',
    '检查清单',
    '分析框架',
    '角色设定',
    '写作方法',
    '运营方案',
    '操作手册',
  ],
  styleTechnique: [
    '专业严谨',
    '简洁直接',
    '结构化输出',
    '分步执行',
    'Few-Shot 示例',
    '角色扮演',
    '清单式',
    '对比分析',
    '表格化',
    '创意发散',
  ],
} as const

export type PromptFacetKey = keyof typeof PROMPT_FACET_PRESETS

export interface FacetDraft {
  selected: string[]
  custom: string
}

function splitCustomValues(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function hydrateFacetDraft(
  values: readonly string[],
  presets: readonly string[],
): FacetDraft {
  const presetSet = new Set(presets)
  const selected: string[] = []
  const custom: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    if (presetSet.has(value)) selected.push(value)
    else custom.push(value)
  }
  return {
    selected: custom.length > 0 ? [...selected, CUSTOM_FACET_OPTION] : selected,
    custom: custom.join(', '),
  }
}

export function serializeFacetDraft(
  draft: FacetDraft,
): string[] {
  const values = draft.selected
    .filter((value) => value !== CUSTOM_FACET_OPTION)
    .map((value) => value.trim())
    .filter(Boolean)
  if (draft.selected.includes(CUSTOM_FACET_OPTION)) {
    values.push(...splitCustomValues(draft.custom))
  }
  return [...new Set(values)]
}
