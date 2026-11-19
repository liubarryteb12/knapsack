/**
 * 单条提示词分享链接编解码契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-share.ts
 */
import {
  decodePromptShare,
  encodePromptShare,
} from '../src/mods/mod-prompts/shareCode'
import {
  PROMPT_SHARE_LINK_BASE,
  decodePromptShareLink,
  encodePromptShareLink,
} from '../src/mods/mod-prompts/shareLink'
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

async function main() {
  const link = await encodePromptShareLink(work, 1000)
  check('分享链接使用行囊自有协议', link.startsWith(PROMPT_SHARE_LINK_BASE))
  const imported = await decodePromptShareLink(link, 2000)
  check('中文与 Emoji 无损往返', imported.title === work.title && imported.payload.templateBody === work.payload.templateBody)
  check('三态载荷与四维标签保留', imported.modality === 'WORK_LLM' && imported.facets.targetTool.join(',') === 'Claude,GPT')
  check('导入生成本机新 ID', imported.id !== work.id && imported.id.length > 0)
  check('调用次数与历史不进入分享链接', imported.usageCount === 0 && imported.history.length === 0)

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
  const importedImage = await decodePromptShareLink(await encodePromptShareLink(image), 3000)
  check('生图负向词与词块权重往返', importedImage.modality === 'IMAGE_GEN' && importedImage.payload.negativePrompt === 'lowres, watermark' && importedImage.payload.activeSnippets[0]?.weight === 1.2)

  const encodedLink = await encodePromptShareLink(work, 4000)
  check('分享链接对 URL 保留字符进行编码', !encodedLink.slice(PROMPT_SHARE_LINK_BASE.length).includes('#'))

  const longWork: PromptItem = {
    ...work,
    id: 'long-work',
    payload: {
      ...work.payload,
      templateBody: '请评审以下需求并给出完整方案。'.repeat(1800),
    },
  }
  const importedLong = await decodePromptShareLink(await encodePromptShareLink(longWork, 5000), 6000)
  check('长提示词链接保留完整正文', importedLong.payload.templateBody === longWork.payload.templateBody)

  const specialWork: PromptItem = {
    ...work,
    title: 'A&B #1 100% ? + =',
    payload: {
      ...work.payload,
      templateBody: '保留 & # ? + = % 与换行\n第二行',
    },
  }
  const importedSpecial = await decodePromptShareLink(await encodePromptShareLink(specialWork, 7000), 8000)
  check('标题与正文特殊字符往返', importedSpecial.title === specialWork.title && importedSpecial.payload.templateBody === specialWork.payload.templateBody)

  const legacyV1 = encodePromptShare(work, 9000)
  const importedLegacyV1 = await decodePromptShareLink(legacyV1, 10_000)
  check('兼容旧 knapsack-prompt/1 分享码', importedLegacyV1.title === work.title)

  const oldWebLink = `https://liubarryteb12.github.io/knapsack/#/prompts?share=${encodeURIComponent(legacyV1)}`
  const importedOldWebLink = await decodePromptShareLink(oldWebLink, 10_500)
  check('兼容旧网页分享链接', importedOldWebLink.title === work.title)

  const pastedFromChat = `试试这个：${link} 请导入`
  const importedFromChat = await decodePromptShareLink(pastedFromChat, 10_700)
  check('可识别聊天文本中的分享链接', importedFromChat.title === work.title)

  const legacyDecoded = decodePromptShare(legacyV1, 11_000)
  check('旧版直接解码仍可用', legacyDecoded.payload.templateBody === work.payload.templateBody)

  let badLink = false
  try {
    await decodePromptShareLink('https://example.com/not-a-prompt')
  } catch {
    badLink = true
  }
  check('非行囊分享链接被拒', badLink)

  let badPayload = false
  try {
    await decodePromptShareLink(`${PROMPT_SHARE_LINK_BASE}knapsack-prompt%2F2%3Fd%3Dnot-gzip`)
  } catch {
    badPayload = true
  }
  check('损坏分享链接被拒', badPayload)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
