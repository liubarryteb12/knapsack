/**
 * mod-prompts multi-target prompt composer contract.
 *
 * Run: node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-composer.ts
 */
import { isDeepStrictEqual } from 'node:util'
import { composePrompt } from '../src/mods/mod-prompts/domain/promptComposer'
import { promptItemSchema, type PromptSnippet } from '../src/mods/mod-prompts/schema'

let failed = 0

function exact(name: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`  ok  ${name}`)
    return
  }

  failed++
  console.error(`FAIL  ${name}`)
  console.error(`  expected: ${JSON.stringify(expected)}`)
  console.error(`  actual:   ${JSON.stringify(actual)}`)
}

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`)
    return
  }

  failed++
  console.error(`FAIL  ${name}${detail ? `: ${detail}` : ''}`)
}

function base() {
  return {
    id: 'prompt-1',
    title: 'Rain Night Portrait 😊',
    facets: {
      targetTool: ['Midjourney'],
      domainTheme: ['Portrait'],
      styleTechnique: ['Cyberpunk'],
    },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

const snippets: PromptSnippet[] = [
  {
    id: 'snippet-weight',
    category: 'STYLE',
    labelZh: '电影感',
    labelEn: 'cinematic',
    textEn: 'cinematic lighting',
    defaultWeight: 1,
    usageCount: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'snippet-heavy',
    category: 'QUALITY',
    labelZh: '高质量',
    labelEn: 'high quality',
    textEn: 'masterpiece',
    defaultWeight: 1.2,
    usageCount: 0,
    createdAt: 1,
    updatedAt: 1,
  },
]

const workItem = promptItemSchema.parse({
  ...base(),
  modality: 'WORK_LLM',
  payload: {
    systemRole: 'Senior reviewer 😊',
    templateBody: 'Review {{subject}} in {{tone:strict}}',
    fewShotExamples: [{ input: 'one', output: 'two' }],
    outputFormat: 'PLAIN',
  },
})

const imageItem = promptItemSchema.parse({
  ...base(),
  modality: 'IMAGE_GEN',
  payload: {
    positivePrompt: 'cinematic portrait in rain',
    positivePromptZh: '雨夜人像',
    negativePrompt: 'blurry, watermark',
    activeSnippets: [
      { snippetId: 'snippet-weight', enabled: true, weight: 1 },
      { snippetId: 'snippet-heavy', enabled: true, weight: 1.2 },
      { snippetId: 'snippet-disabled', enabled: false, weight: 2 },
    ],
    imageParams: {
      aspectRatio: '16:9',
      targetModel: 'Midjourney',
      styleRef: 'cyberpunk-film',
      seed: '42',
    },
  },
})

const imageWithoutOptionalParams = promptItemSchema.parse({
  ...base(),
  id: 'image-minimal',
  modality: 'IMAGE_GEN',
  payload: {
    positivePrompt: 'clean portrait 🌊',
    negativePrompt: '',
    activeSnippets: [],
    imageParams: {
      aspectRatio: '1:1',
      targetModel: 'Stable Diffusion',
      styleRef: '',
      seed: '',
    },
  },
})

const videoItem = promptItemSchema.parse({
  ...base(),
  modality: 'VIDEO_GEN',
  payload: {
    subjectAndScene: 'Neon street 🌧️',
    motionDynamics: 'Rain slides down an umbrella',
    cameraMovement: ['DOLLY_IN', 'ORBIT'],
    atmosphereAndLighting: 'Cold blue and magenta light',
    videoParams: {
      durationSec: 10,
      aspectRatio: '16:9',
      fps: 24,
      requiresStartEndFrame: true,
      frameNotes: 'Start: street empty; End: person centered',
    },
  },
})

const videoMinimal = promptItemSchema.parse({
  ...base(),
  id: 'video-minimal',
  modality: 'VIDEO_GEN',
  payload: {
    subjectAndScene: 'Quiet room 🌊',
    motionDynamics: '',
    cameraMovement: [],
    atmosphereAndLighting: '',
    videoParams: {
      durationSec: 5,
      aspectRatio: '16:9',
      fps: 24,
      requiresStartEndFrame: false,
      frameNotes: '',
    },
  },
})

function main() {
  exact(
    'WORK_PLAIN renders variables and keeps an unfilled variable as its source',
    composePrompt(workItem, {
      target: 'WORK_PLAIN',
      variables: { subject: 'Q3 plan' },
    }),
    'Senior reviewer 😊\n\nReview Q3 plan in strict',
  )

  exact(
    'WORK_PLAIN preserves an unfilled variable but applies its default',
    composePrompt(workItem, { target: 'WORK_PLAIN' }),
    'Senior reviewer 😊\n\nReview {{subject}} in strict',
  )

  exact(
    'WORK_MARKDOWN uses the same rendered body',
    composePrompt(workItem, {
      target: 'WORK_MARKDOWN',
      variables: { subject: 'Q3 plan', tone: 'friendly' },
    }),
    '# Senior reviewer 😊\n\nReview Q3 plan in friendly',
  )

  exact(
    'WORK_JSON is deterministic and includes few-shot examples',
    composePrompt(workItem, {
      target: 'WORK_JSON',
      variables: { subject: 'Q3 plan' },
    }),
    JSON.stringify(
      {
        systemRole: 'Senior reviewer 😊',
        prompt: 'Review Q3 plan in strict',
        fewShotExamples: [{ input: 'one', output: 'two' }],
      },
      null,
      2,
    ),
  )

  exact(
    'Midjourney joins positive text, enabled snippets, and omitted empty params',
    composePrompt(imageItem, {
      target: 'Midjourney',
      snippets,
    }),
    'cinematic portrait in rain cinematic lighting masterpiece --ar 16:9 --no blurry, watermark --sref cyberpunk-film --v 6.1',
  )

  exact(
    'SD_POSITIVE formats non-1 snippet weights',
    composePrompt(imageItem, {
      target: 'SD_POSITIVE',
      snippets,
    }),
    'cinematic portrait in rain cinematic lighting (masterpiece:1.2)',
  )

  exact(
    'SD_NEGATIVE returns the negative prompt only',
    composePrompt(imageItem, { target: 'SD_NEGATIVE' }),
    'blurry, watermark',
  )

  exact('empty negative word produces empty output', composePrompt(imageWithoutOptionalParams, { target: 'SD_NEGATIVE' }), '')
  exact(
    'Midjourney omits an absent negative prompt',
    composePrompt(imageWithoutOptionalParams, { target: 'Midjourney' }),
    'clean portrait 🌊 --ar 1:1 --v 6.1',
  )

  exact(
    'VIDEO_ZH emits the four sections in fixed order',
    composePrompt(videoItem, { target: 'VIDEO_ZH' }),
    [
      '主体与场景：Neon street 🌧️',
      '动态：Rain slides down an umbrella',
      '运镜：缓慢推近，环绕运镜',
      '氛围与光线：Cold blue and magenta light',
    ].join('\n'),
  )

  exact(
    'VIDEO_EN uses English section labels and camera movements',
    composePrompt(videoItem, { target: 'VIDEO_EN' }),
    [
      'Subject and scene: Neon street 🌧️',
      'Motion dynamics: Rain slides down an umbrella',
      'Camera movement: dolly in, orbit',
      'Atmosphere and lighting: Cold blue and magenta light',
    ].join('\n'),
  )

  exact(
    'VIDEO_ZH omits empty optional sections',
    composePrompt(videoMinimal, { target: 'VIDEO_ZH' }),
    '主体与场景：Quiet room 🌊',
  )

  exact(
    'VIDEO_EN omits empty optional sections',
    composePrompt(videoMinimal, { target: 'VIDEO_EN' }),
    'Subject and scene: Quiet room 🌊',
  )

  let rejected = false
  try {
    composePrompt(workItem, { target: 'SD_NEGATIVE' })
  } catch {
    rejected = true
  }
  check('invalid compose request is rejected', rejected)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main()
