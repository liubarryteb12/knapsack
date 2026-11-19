import type { WorkPromptProjection } from '../../../core/capabilityContracts'
import type { PromptItem } from '../schema'

/**
 * 提示词库 → 看板的只读投影：只取 WORK_LLM 条目，
 * 不暴露存储行，正文原样返回（人格引用需要 systemRole 摘要）。
 */
export function projectWorkPrompts(items: PromptItem[]): WorkPromptProjection[] {
  return items
    .filter((item) => item.modality === 'WORK_LLM')
    .map((item) => ({
      id: item.id,
      title: item.title,
      systemRole: item.payload.systemRole,
      templateBody: item.payload.templateBody,
      outputFormat: item.payload.outputFormat,
      facets: {
        targetTool: [...item.facets.targetTool],
        domainTheme: [...item.facets.domainTheme],
        styleTechnique: [...item.facets.styleTechnique],
      },
      updatedAt: item.updatedAt,
    }))
}
