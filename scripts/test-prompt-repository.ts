/**
 * mod-prompts Dexie repository 契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-repository.ts
 */
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { DexiePromptRepository } from '../src/mods/mod-prompts/services/dexieRepository'
import type { PromptItem, PromptMediaRecord, PromptSnippet } from '../src/mods/mod-prompts/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

const item: PromptItem = {
  id: 'item-1',
  title: '评审架构',
  modality: 'WORK_LLM',
  facets: {
    targetTool: ['Claude'],
    domainTheme: ['架构设计'],
    styleTechnique: ['Few-Shot'],
  },
  isFavorite: true,
  usageCount: 3,
  version: 1,
  history: [],
  createdAt: 1,
  updatedAt: 2,
  payload: {
    systemRole: '资深架构师',
    templateBody: '评审 {{主题}}',
    fewShotExamples: [],
    outputFormat: 'MARKDOWN',
  },
}

const snippet: PromptSnippet = {
  id: 'snippet-1',
  category: 'LIGHTING',
  labelZh: '电影光',
  labelEn: 'cinematic lighting',
  textEn: 'cinematic lighting',
  defaultWeight: 1,
  usageCount: 0,
  createdAt: 1,
  updatedAt: 1,
}

async function main() {
  const repo = new DexiePromptRepository(db)
  await repo.clearAll()

  await repo.putItem(item)
  check('提示词可写入并读回', (await repo.getItem(item.id))?.title === '评审架构')
  check('列表按更新时间倒序', (await repo.listItems())[0]?.id === item.id)

  await repo.putSnippet(snippet)
  check('词块可写入并读回', (await repo.listSnippets())[0]?.textEn === 'cinematic lighting')

  const blob = new Blob([new Uint8Array(512)], { type: 'image/webp' })
  const media: PromptMediaRecord = {
    mediaId: 'media-1',
    itemId: item.id,
    blob,
    mimeType: 'image/webp',
    byteLength: 512,
    longEdge: 600,
    createdAt: 1,
  }
  await repo.putMedia(media)
  check('缩略图 Blob 可读回', (await repo.getMedia(media.mediaId))?.blob.size === 512)
  check('按条目读取封面媒体', (await repo.listMediaByItem(item.id))[0]?.mediaId === 'media-1')

  await repo.deleteItem(item.id)
  check('删除提示词后主记录消失', !(await repo.getItem(item.id)))
  check('删除提示词后关联媒体消失', !(await repo.getMedia(media.mediaId)))

  let rejected = false
  try {
    await repo.putItem({ ...item, title: '' })
  } catch {
    rejected = true
  }
  check('损坏输入在写库前被拒绝', rejected)

  await repo.clearAll()
  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
