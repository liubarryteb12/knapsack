/**
 * mod-prompts 四维分面筛选契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-filter.ts
 */
import { performance } from 'node:perf_hooks'
import { filterPromptItems } from '../src/mods/mod-prompts/domain/facetedFilter'
import { promptItemSchema, type PromptItem } from '../src/mods/mod-prompts/schema'

let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`)
    return
  }

  failed++
  console.error(`FAIL  ${name}${detail ? `: ${detail}` : ''}`)
}

function ids(items: readonly PromptItem[]) {
  return items.map((item) => item.id)
}

const workArchitecture = promptItemSchema.parse({
  id: 'work-architecture',
  title: '架构评审',
  modality: 'WORK_LLM',
  facets: {
    targetTool: ['Claude', 'GPT'],
    domainTheme: ['架构设计'],
    styleTechnique: ['Few-Shot'],
  },
  payload: {
    systemRole: 'Terraform specialist',
    templateBody: '请评审 {{主题}} 并给出风险清单',
    fewShotExamples: [],
    outputFormat: 'MARKDOWN',
  },
  isFavorite: true,
  usageCount: 5,
  version: 1,
  history: [],
  createdAt: 10,
  updatedAt: 90,
})

const workCopywriting = promptItemSchema.parse({
  id: 'work-copywriting',
  title: '营销文案',
  modality: 'WORK_LLM',
  facets: {
    targetTool: ['GPT'],
    domainTheme: ['文案润色'],
    styleTechnique: ['结构化JSON'],
  },
  payload: {
    systemRole: '资深品牌文案',
    templateBody: '把产品卖点改写为短句',
    fewShotExamples: [{ input: '输入样例', output: '输出样例' }],
    outputFormat: 'PLAIN',
  },
  isFavorite: false,
  usageCount: 20,
  version: 1,
  history: [],
  createdAt: 20,
  updatedAt: 80,
})

const imageCyberpunk = promptItemSchema.parse({
  id: 'image-cyberpunk',
  title: '雨夜人像',
  modality: 'IMAGE_GEN',
  facets: {
    targetTool: ['Midjourney'],
    domainTheme: ['写实人像'],
    styleTechnique: ['赛博朋克'],
  },
  payload: {
    positivePrompt: 'cinematic portrait',
    positivePromptZh: '霓虹雨夜里的银发人像',
    negativePrompt: 'lowres, watermark',
    activeSnippets: [],
    imageParams: {
      aspectRatio: '16:9',
      targetModel: 'Midjourney',
      styleRef: 'cyberpunk-film',
      seed: '42',
    },
  },
  isFavorite: true,
  usageCount: 8,
  version: 1,
  history: [],
  createdAt: 30,
  updatedAt: 70,
})

const videoDancer = promptItemSchema.parse({
  id: 'video-dancer',
  title: '舞台特写',
  modality: 'VIDEO_GEN',
  facets: {
    targetTool: ['Sora'],
    domainTheme: ['人物动态'],
    styleTechnique: ['慢动作特写'],
  },
  payload: {
    subjectAndScene: '聚光灯下的舞者',
    motionDynamics: '裙摆旋转并扬起细碎亮片',
    cameraMovement: ['DOLLY_IN'],
    atmosphereAndLighting: '暖金色舞台光',
    videoParams: {
      durationSec: 10,
      aspectRatio: '16:9',
      fps: 24,
      requiresStartEndFrame: false,
      frameNotes: '',
    },
  },
  isFavorite: false,
  usageCount: 12,
  version: 1,
  history: [],
  createdAt: 40,
  updatedAt: 60,
})

const videoNature = promptItemSchema.parse({
  id: 'video-nature',
  title: '山谷航拍',
  modality: 'VIDEO_GEN',
  facets: {
    targetTool: ['Runway'],
    domainTheme: ['自然风景'],
    styleTechnique: ['延时摄影'],
  },
  payload: {
    subjectAndScene: '晨雾中的山谷',
    motionDynamics: '云层缓慢流动',
    cameraMovement: ['FPV_DRONE'],
    atmosphereAndLighting: '清晨侧逆光',
    videoParams: {
      durationSec: 5,
      aspectRatio: '16:9',
      fps: 30,
      requiresStartEndFrame: false,
      frameNotes: '',
    },
  },
  isFavorite: false,
  usageCount: 1,
  version: 1,
  history: [],
  createdAt: 50,
  updatedAt: 50,
})

const fixture = [
  workArchitecture,
  workCopywriting,
  imageCyberpunk,
  videoDancer,
  videoNature,
]

function testEmptyFilter() {
  const result = filterPromptItems(fixture, {})

  check('空筛选返回全部条目', result.items.length === fixture.length)
  check(
    '空筛选默认收藏优先、收藏内按最近更新',
    JSON.stringify(ids(result.items)) ===
      JSON.stringify([
        'work-architecture',
        'image-cyberpunk',
        'work-copywriting',
        'video-dancer',
        'video-nature',
      ]),
  )
  check('空筛选统计三种模态',
    result.facets.modality.WORK_LLM === 2 &&
      result.facets.modality.IMAGE_GEN === 1 &&
      result.facets.modality.VIDEO_GEN === 2,
  )
  check('空筛选统计三维标签',
    result.facets.targetTool.Claude === 1 &&
      result.facets.domainTheme['架构设计'] === 1 &&
      result.facets.styleTechnique['赛博朋克'] === 1,
  )
}

function testSameDimensionOr() {
  const targetTools = filterPromptItems(fixture, {
    targetTool: ['Claude', 'GPT'],
  })
  check(
    'targetTool 同维 OR',
    JSON.stringify(ids(targetTools.items).sort()) ===
      JSON.stringify(['work-architecture', 'work-copywriting']),
  )

  const modalities = filterPromptItems(fixture, {
    modality: ['IMAGE_GEN', 'VIDEO_GEN'],
  })
  check(
    'modality 同维 OR',
    JSON.stringify(ids(modalities.items).sort()) ===
      JSON.stringify(['image-cyberpunk', 'video-dancer', 'video-nature']),
  )
}

function testCrossDimensionAnd() {
  const result = filterPromptItems(fixture, {
    modality: ['WORK_LLM'],
    targetTool: ['Claude'],
    domainTheme: ['架构设计'],
    styleTechnique: ['Few-Shot'],
  })

  check(
    '四维跨维 AND',
    JSON.stringify(ids(result.items)) === JSON.stringify(['work-architecture']),
  )
  check(
    '跨维筛选后重新统计 facet',
    result.facets.modality.WORK_LLM === 1 &&
      result.facets.targetTool.Claude === 1 &&
      result.facets.targetTool.GPT === 1,
  )
}

function testKeywordSearch() {
  const keywordCases = [
    { keyword: 'terraform', expected: 'work-architecture' },
    { keyword: '银发人像', expected: 'image-cyberpunk' },
    { keyword: '亮片', expected: 'video-dancer' },
  ]

  for (const testCase of keywordCases) {
    const result = filterPromptItems(fixture, {
      keyword: testCase.keyword,
      sortBy: 'recent',
    })
    check(
      `关键词命中 payload 文本：${testCase.keyword}`,
      result.items.length === 1 && result.items[0]?.id === testCase.expected,
    )
  }

  const titleResult = filterPromptItems(fixture, { keyword: '营销文案' })
  check(
    '关键词命中标题',
    titleResult.items.length === 1 && titleResult.items[0]?.id === 'work-copywriting',
  )
}

function testSorting() {
  const recent = filterPromptItems(fixture, { sortBy: 'recent' })
  check(
    '最近更新排序',
    JSON.stringify(ids(recent.items)) ===
      JSON.stringify([
        'work-architecture',
        'work-copywriting',
        'image-cyberpunk',
        'video-dancer',
        'video-nature',
      ]),
  )

  const usage = filterPromptItems(fixture, { sortBy: 'usage' })
  check(
    '使用频次排序',
    JSON.stringify(ids(usage.items)) ===
      JSON.stringify([
        'work-copywriting',
        'video-dancer',
        'image-cyberpunk',
        'work-architecture',
        'video-nature',
      ]),
  )

  const favorite = filterPromptItems(fixture, { sortBy: 'favorite' })
  check(
    '收藏优先排序',
    JSON.stringify(ids(favorite.items)) ===
      JSON.stringify([
        'work-architecture',
        'image-cyberpunk',
        'work-copywriting',
        'video-dancer',
        'video-nature',
      ]),
  )

  const title = filterPromptItems(fixture, { sortBy: 'title' })
  check(
    '标题排序',
    JSON.stringify(ids(title.items)) ===
      JSON.stringify([
        'work-architecture',
        'video-nature',
        'video-dancer',
        'work-copywriting',
        'image-cyberpunk',
      ]),
  )
}

function makePerformanceFixture(): PromptItem[] {
  return Array.from({ length: 1000 }, (_, index) =>
    promptItemSchema.parse({
      id: `perf-${index}`,
      title: `性能样本 ${index}`,
      modality: 'WORK_LLM',
      facets: {
        targetTool: [index % 2 === 0 ? 'Claude' : 'GPT'],
        domainTheme: [index % 3 === 0 ? '数据分析' : '代码重构'],
        styleTechnique: [index % 4 === 0 ? 'Few-Shot' : 'CoT思维链'],
      },
      payload: {
        systemRole: index === 500 ? 'needle-token' : '性能测试角色',
        templateBody: `请处理第 ${index} 条样本`,
        fewShotExamples: [],
        outputFormat: 'JSON',
      },
      isFavorite: index % 10 === 0,
      usageCount: index,
      version: 1,
      history: [],
      createdAt: index,
      updatedAt: index,
    }),
  )
}

function testPerformance() {
  const items = makePerformanceFixture()
  const startedAt = performance.now()
  const result = filterPromptItems(items, {
    modality: ['WORK_LLM'],
    targetTool: ['Claude'],
    keyword: 'needle-token',
    sortBy: 'usage',
  })
  const elapsedMs = performance.now() - startedAt

  check(
    '1000 条组合筛选结果正确',
    result.items.length === 1 && result.items[0]?.id === 'perf-500',
    `得到 ${result.items.length} 条`,
  )
  check(
    '1000 条组合筛选保持基本性能',
    elapsedMs < 250,
    `${elapsedMs.toFixed(2)}ms`,
  )
  console.log(`  info 1000 items filtered in ${elapsedMs.toFixed(2)}ms`)
}

function main() {
  testEmptyFilter()
  testSameDimensionOr()
  testCrossDimensionAnd()
  testKeywordSearch()
  testSorting()
  testPerformance()

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main()
