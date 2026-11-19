/**
 * 提示词库 → 看板人格目录投影测试。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-work-prompt-catalog.ts
 */
import { projectWorkPrompts } from '../src/mods/mod-prompts/services/workPromptCatalog'
import { promptItemSchema, type PromptItem } from '../src/mods/mod-prompts/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function workItem(id: string, title: string, systemRole = '你是研究者'): PromptItem {
  return promptItemSchema.parse({
    id,
    title,
    modality: 'WORK_LLM',
    facets: { targetTool: ['通用'], domainTheme: ['研究'], styleTechnique: ['清单'] },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: 1,
    updatedAt: 10,
    payload: {
      systemRole,
      templateBody: '请完成任务：{{task}}',
      fewShotExamples: [],
      outputFormat: 'JSON',
    },
  })
}

function imageItem(id: string): PromptItem {
  return promptItemSchema.parse({
    id,
    title: '封面图',
    modality: 'IMAGE_GEN',
    facets: { targetTool: ['MJ'], domainTheme: ['插画'], styleTechnique: [] },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: 1,
    updatedAt: 10,
    payload: { positivePrompt: 'a cat', positivePromptZh: '', negativePrompt: '', activeSnippets: [], imageParams: { targetModel: '', styleRef: '', seed: '' } },
  })
}

{
  const items = [workItem('p1', '研究助手'), imageItem('p2'), workItem('p3', '写作者', '你是写作者')]
  const projections = projectWorkPrompts(items)
  check('只投影 WORK_LLM 条目', projections.length === 2)
  check('保留 id/title', projections[0]?.id === 'p1' && projections[0]?.title === '研究助手')
  check('systemRole 透传', projections[0]?.systemRole === '你是研究者')
  check('outputFormat 透传', projections[0]?.outputFormat === 'JSON')
  check('facets 深拷贝，不与原对象共享', projections[0]?.facets.targetTool !== items[0]!.facets.targetTool)
  check('正文不丢', projections[0]?.templateBody.includes('{{task}}'))
}

{
  const empty = projectWorkPrompts([imageItem('x')])
  check('无 WORK_LLM 时返回空数组', empty.length === 0)
}

console.log(failed === 0 ? '\nwork-prompt-catalog: all passed' : `\nwork-prompt-catalog: ${failed} failed`)
if (failed > 0) process.exit(1)
