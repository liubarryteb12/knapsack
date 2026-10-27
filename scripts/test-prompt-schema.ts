/**
 * mod-prompts 三态 Schema 契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-schema.ts
 */
import {
  promptItemSchema,
  promptMediaSchema,
  promptSnippetSchema,
  type PromptItem,
} from '../src/mods/mod-prompts/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function base() {
  return {
    id: 'prompt-1',
    title: '高级架构师评审',
    facets: {
      targetTool: ['Claude'],
      domainTheme: ['架构设计'],
      styleTechnique: ['Few-Shot'],
    },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

async function main() {
  const work: PromptItem = promptItemSchema.parse({
    ...base(),
    modality: 'WORK_LLM',
    payload: {
      systemRole: '你是一位资深系统架构师',
      templateBody: '请用 {{语气:严谨}} 的语气评审 {{主题}}',
      fewShotExamples: [],
      outputFormat: 'MARKDOWN',
    },
  })
  check('工作提示词可解析', work.modality === 'WORK_LLM' && work.payload.templateBody.includes('{{主题}}'))

  const image: PromptItem = promptItemSchema.parse({
    ...base(),
    id: 'prompt-2',
    modality: 'IMAGE_GEN',
    payload: {
      positivePrompt: 'cinematic portrait in rain',
      positivePromptZh: '雨夜电影感人像',
      negativePrompt: 'lowres, watermark',
      activeSnippets: [{ snippetId: 'sn-1', enabled: true, weight: 1.2 }],
      imageParams: {
        aspectRatio: '16:9',
        targetModel: 'Midjourney',
        styleRef: '',
        seed: '',
      },
    },
  })
  check('生图提示词可解析', image.modality === 'IMAGE_GEN' && image.payload.activeSnippets[0]?.weight === 1.2)

  const video: PromptItem = promptItemSchema.parse({
    ...base(),
    id: 'prompt-3',
    modality: 'VIDEO_GEN',
    payload: {
      subjectAndScene: '雨夜里的霓虹街道',
      motionDynamics: '雨水顺着伞骨滑落',
      cameraMovement: ['DOLLY_IN', 'ORBIT'],
      atmosphereAndLighting: '冷蓝与洋红电影光',
      videoParams: {
        durationSec: 10,
        aspectRatio: '16:9',
        fps: 24,
        requiresStartEndFrame: false,
        frameNotes: '',
      },
    },
  })
  check('生视频四段式可解析', video.modality === 'VIDEO_GEN' && video.payload.cameraMovement.length === 2)

  const badImage = promptItemSchema.safeParse({
    ...base(),
    modality: 'IMAGE_GEN',
    payload: {
      positivePrompt: 'x',
      positivePromptZh: '',
      negativePrompt: '',
      activeSnippets: [
        { snippetId: 'same', enabled: true, weight: 1 },
        { snippetId: 'same', enabled: false, weight: 1 },
      ],
      imageParams: { aspectRatio: '5:4', targetModel: '', styleRef: '', seed: '' },
    },
  })
  check('重复词块引用与非法比例被拒', !badImage.success)

  const badVideo = promptItemSchema.safeParse({
    ...base(),
    modality: 'VIDEO_GEN',
    payload: {
      subjectAndScene: '主体',
      motionDynamics: '',
      cameraMovement: ['SPIN'],
      atmosphereAndLighting: '',
      videoParams: { durationSec: 7, aspectRatio: '16:9', fps: 24 },
    },
  })
  check('非法运镜与非法时长被拒', !badVideo.success)

  const snippet = promptSnippetSchema.parse({
    id: 'snippet-1',
    category: 'LIGHTING',
    labelZh: '电影光',
    labelEn: 'cinematic lighting',
    textEn: 'cinematic lighting',
    defaultWeight: 1,
    usageCount: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  check('词块字典 Schema 可解析', snippet.category === 'LIGHTING')

  const blob = new Blob([new Uint8Array(1024)], { type: 'image/webp' })
  const media = promptMediaSchema.parse({
    mediaId: 'media-1',
    itemId: 'prompt-1',
    blob,
    mimeType: 'image/webp',
    byteLength: blob.size,
    longEdge: 600,
    createdAt: 1,
  })
  check('WebP 缩略图媒体可解析', media.byteLength === 1024)

  const oversized = promptMediaSchema.safeParse({
    ...media,
    byteLength: 150 * 1024 + 1,
  })
  check('超过 150KB 的缩略图被拒', !oversized.success)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
