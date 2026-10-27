/**
 * mod-prompts Pinia store 契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-store.ts
 */
import { createPinia, setActivePinia } from 'pinia'
import { InMemoryPromptRepository } from '../src/mods/mod-prompts/services/inMemoryRepository'
import { createPromptsStore } from '../src/mods/mod-prompts/store'
import type { PromptItem } from '../src/mods/mod-prompts/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function item(title: string): PromptItem {
  return {
    id: 'item-store-1',
    title,
    modality: 'WORK_LLM',
    facets: { targetTool: [], domainTheme: [], styleTechnique: [] },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: 100,
    updatedAt: 100,
    payload: {
      systemRole: '',
      templateBody: '请分析 {{主题}}',
      fewShotExamples: [],
      outputFormat: 'PLAIN',
    },
  }
}

async function main() {
  setActivePinia(createPinia())
  const repository = new InMemoryPromptRepository()
  const useStore = createPromptsStore(repository, 'prompt-test')
  const store = useStore()

  await store.load()
  check('初始列表为空', store.items.length === 0)

  await store.createItem(item('第一版'))
  check('新增后进入列表', store.items[0]?.title === '第一版')

  const current = store.items[0]!
  await store.updateItem({ ...current, title: '第二版', updatedAt: 200 })
  const updated = store.items[0]!
  check('编辑递增版本号', updated.version === 2)
  check('编辑保留轻量历史摘要', updated.history.length === 1 && updated.history[0]?.summary.includes('第一版'))

  await store.toggleFavorite(updated.id)
  check('收藏可切换', store.items[0]?.isFavorite === true)

  await store.incrementUsage(updated.id)
  check('复制后调用次数递增', store.items[0]?.usageCount === 1)

  for (let version = 3; version <= 13; version++) {
    const row = store.items[0]!
    await store.updateItem({ ...row, title: `第 ${version} 版`, updatedAt: version * 100 })
  }
  check('历史记录最多保留 10 条', store.items[0]?.history.length === 10)

  await store.saveSnippet({
    id: 'snippet-store-1',
    category: 'QUALITY',
    labelZh: '高清',
    labelEn: 'high detail',
    textEn: 'high detail',
    defaultWeight: 1,
    usageCount: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  check('词块保存后进入列表', store.snippets[0]?.textEn === 'high detail')

  await store.removeItem(updated.id)
  check('删除后列表清空', store.items.length === 0)

  let rejected = false
  try {
    await store.createItem({ ...item(''), id: 'bad-empty-title' })
  } catch {
    rejected = true
  }
  check('非法数据不会进入 store', rejected && store.items.length === 0)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
