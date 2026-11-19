/**
 * 提示词编辑器的预设分类与“其他”手填契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-facet-options.ts
 */
import {
  CUSTOM_FACET_OPTION,
  PROMPT_FACET_PRESETS,
  hydrateFacetDraft,
  serializeFacetDraft,
} from '../src/mods/mod-prompts/facetOptions'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

check('分类预设包含提示词与工作规范', PROMPT_FACET_PRESETS.domainTheme.includes('提示词') && PROMPT_FACET_PRESETS.domainTheme.includes('工作规范'))
check('三组预设均无重复项', Object.values(PROMPT_FACET_PRESETS).every((values) => new Set(values).size === values.length))

const hydrated = hydrateFacetDraft(['工作协作', '短视频选题'], PROMPT_FACET_PRESETS.targetTool)
check('已有预设值回填到下拉', hydrated.selected.includes('工作协作'))
check('未收录旧值进入其他', hydrated.selected.includes(CUSTOM_FACET_OPTION) && hydrated.custom === '短视频选题')

const serialized = serializeFacetDraft(
  { selected: ['工作协作', CUSTOM_FACET_OPTION], custom: '公众号运营, 工作协作' },
)
check('保存时合并预设与其他', serialized.includes('工作协作') && serialized.includes('公众号运营'))
check('保存时去除重复标签', serialized.filter((value) => value === '工作协作').length === 1)

const withoutOther = serializeFacetDraft(
  { selected: ['工作协作'], custom: '不会保存' },
)
check('未选其他时忽略手填值', !withoutOther.includes('不会保存'))

console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
if (failed > 0) process.exit(1)
