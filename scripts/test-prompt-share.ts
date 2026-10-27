/**
 * 单条提示词面对面二维码分享编解码。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-share.ts
 */
import { decodePromptShare, encodePromptShare } from '../src/mods/mod-prompts/shareCode'
import type { PromptItem } from '../src/mods/mod-prompts/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

const work: PromptItem = {
  id: 'local-id',
  title: '中文评审 😊',
  modality: 'WORK_LLM',
  facets: {
    targetTool: ['Claude', 'GPT'],
    domainTheme: ['架构设计'],
    styleTechnique: ['Few-Shot'],
  },
  isFavorite: true,
  usageCount: 99,
  version: 8,
  history: [{ version: 7, updatedAt: 1, summary: 'old' }],
  createdAt: 10,
  updatedAt: 20,
  payload: {
    systemRole: '资深架构师',
    templateBody: '评审 {{主题:登录模块}} 😊',
    fewShotExamples: [{ input: '输入', output: '输出' }],
    outputFormat: 'MARKDOWN',
  },
}

function main() {
  const code = encodePromptShare(work, 1000)
  check('分享码使用独立协议前缀', code.startsWith('knapsack-prompt/1?d='))
  const imported = decodePromptShare(code, 2000)
  check('中文与 Emoji 无损往返', imported.title === work.title && imported.payload.templateBody === work.payload.templateBody)
  check('三态载荷与四维标签保留', imported.modality === 'WORK_LLM' && imported.facets.targetTool.join(',') === 'Claude,GPT')
  check('导入生成本机新 ID', imported.id !== work.id && imported.id.length > 0)
  check('调用次数与历史不进入分享码', imported.usageCount === 0 && imported.history.length === 0)

  const image: PromptItem = {
    ...work,
    id: 'image-id',
    modality: 'IMAGE_GEN',
    payload: {
      positivePrompt: 'cinematic rain portrait',
      positivePromptZh: '雨夜人像',
      negativePrompt: 'lowres, watermark',
      activeSnippets: [{ snippetId: 's1', enabled: true, weight: 1.2 }],
      imageParams: { aspectRatio: '16:9', targetModel: 'Midjourney', styleRef: '', seed: '42' },
    },
  }
  const importedImage = decodePromptShare(encodePromptShare(image), 3000)
  check('生图负向词与词块权重往返', importedImage.modality === 'IMAGE_GEN' && importedImage.payload.negativePrompt === 'lowres, watermark' && importedImage.payload.activeSnippets[0]?.weight === 1.2)

  let badPrefix = false
  try {
    decodePromptShare('https://example.com/not-a-prompt')
  } catch {
    badPrefix = true
  }
  check('非行囊提示词码被拒', badPrefix)

  let badPayload = false
  try {
    decodePromptShare('knapsack-prompt/1?d=not-json')
  } catch {
    badPayload = true
  }
  check('损坏载荷被拒', badPayload)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main()
