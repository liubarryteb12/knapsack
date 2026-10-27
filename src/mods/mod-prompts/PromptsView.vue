<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  NButton,
  NCard,
  NInput,
  NPopconfirm,
  NSelect,
  NTabPane,
  NTabs,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  BriefcaseBusiness,
  Clipboard,
  Image,
  Pencil,
  Play,
  Plus,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Video,
} from '@lucide/vue'
import UiEmptyState from '../../components/ui/UiEmptyState.vue'
import UiPageHeader from '../../components/ui/UiPageHeader.vue'
import PromptEditorModal from './components/PromptEditorModal.vue'
import PromptRunnerDrawer from './components/PromptRunnerDrawer.vue'
import PromptShareModal from './components/PromptShareModal.vue'
import PromptSnippetDictTab from './components/PromptSnippetDictTab.vue'
import PromptThumb from './components/PromptThumb.vue'
import {
  filterPromptItems,
  type PromptSortMode,
} from './domain/facetedFilter'
import { composePrompt, type PromptComposeTarget } from './domain/promptComposer'
import {
  PROMPT_MODALITY_LABELS,
  type PromptItem,
  type PromptModality,
} from './schema'
import { usePromptsStore } from './store'

const store = usePromptsStore()
const message = useMessage()
const activeTab = ref<'gallery' | 'snippets'>('gallery')
const showEditor = ref(false)
const editingItem = ref<PromptItem | null>(null)
const showRunner = ref(false)
const runningItem = ref<PromptItem | null>(null)
const showShare = ref(false)
const sharingItem = ref<PromptItem | null>(null)

const filters = reactive({
  keyword: '',
  modality: 'ALL' as 'ALL' | PromptModality,
  targetTool: [] as string[],
  domainTheme: [] as string[],
  styleTechnique: [] as string[],
  sortBy: 'favorite' as PromptSortMode,
})

onMounted(() => {
  void store.load()
})

const sortOptions = [
  { value: 'favorite', label: '收藏优先' },
  { value: 'recent', label: '最近更新' },
  { value: 'usage', label: '最常使用' },
  { value: 'title', label: '标题排序' },
]

const modalityOptions = [
  { value: 'ALL', label: '全部模态' },
  ...Object.entries(PROMPT_MODALITY_LABELS).map(([value, label]) => ({ value, label })),
]

function toOptions(values: Record<string, number>) {
  return Object.entries(values)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: `${value} (${count})` }))
}

const allFacets = computed(() => filterPromptItems(store.items, { sortBy: 'recent' }).facets)
const targetToolOptions = computed(() => toOptions(allFacets.value.targetTool))
const themeOptions = computed(() => toOptions(allFacets.value.domainTheme))
const styleOptions = computed(() => toOptions(allFacets.value.styleTechnique))

const filtered = computed(() =>
  filterPromptItems(store.items, {
    keyword: filters.keyword,
    modality: filters.modality === 'ALL' ? undefined : filters.modality,
    targetTool: filters.targetTool,
    domainTheme: filters.domainTheme,
    styleTechnique: filters.styleTechnique,
    sortBy: filters.sortBy,
  }),
)

function openNew() {
  editingItem.value = null
  showEditor.value = true
}

function openEdit(item: PromptItem) {
  editingItem.value = item
  showEditor.value = true
}

function openRunner(item: PromptItem) {
  runningItem.value = item
  showRunner.value = true
}

function openShare(item?: PromptItem) {
  sharingItem.value = item ?? null
  showShare.value = true
}

async function remove(item: PromptItem) {
  try {
    await store.removeItem(item.id)
    message.success('提示词已删除')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function toggleFavorite(item: PromptItem) {
  try {
    await store.toggleFavorite(item.id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

function defaultTarget(item: PromptItem): PromptComposeTarget {
  if (item.modality === 'IMAGE_GEN') return 'Midjourney'
  if (item.modality === 'VIDEO_GEN') return 'VIDEO_ZH'
  return 'WORK_PLAIN'
}

function previewText(item: PromptItem): string {
  if (item.modality === 'WORK_LLM') return item.payload.templateBody
  if (item.modality === 'IMAGE_GEN') return item.payload.positivePrompt
  return [item.payload.subjectAndScene, item.payload.motionDynamics].filter(Boolean).join(' · ')
}

function modalityIcon(item: PromptItem) {
  if (item.modality === 'IMAGE_GEN') return Image
  if (item.modality === 'VIDEO_GEN') return Video
  return BriefcaseBusiness
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

async function copyDirect(item: PromptItem) {
  try {
    const text = composePrompt(item, { target: defaultTarget(item), snippets: store.snippets })
    if (!text.trim()) {
      message.warning('当前方言没有可复制内容')
      return
    }
    await writeClipboard(text)
    await store.incrementUsage(item.id)
    message.success('已复制')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="prompts-page">
    <UiPageHeader title="提示词库" subtitle="收集工作、生图与生视频提示词，填变量后直接复制">
      <n-button @click="openShare()">
        <template #icon><Share2 :size="15" /></template>
        导入分享码
      </n-button>
      <n-button type="primary" @click="openNew">
        <template #icon><Plus :size="15" /></template>
        新建提示词
      </n-button>
    </UiPageHeader>

    <n-tabs v-model:value="activeTab" type="line" animated>
      <n-tab-pane name="gallery" tab="提示词画廊">
        <div class="filter-panel">
          <n-input
            v-model:value="filters.keyword"
            clearable
            placeholder="搜索标题、人设、正文与参数"
          />
          <n-select v-model:value="filters.modality" :options="modalityOptions" />
          <n-select
            v-model:value="filters.targetTool"
            multiple
            clearable
            max-tag-count="responsive"
            :options="targetToolOptions"
            placeholder="适用工具"
          />
          <n-select
            v-model:value="filters.domainTheme"
            multiple
            clearable
            max-tag-count="responsive"
            :options="themeOptions"
            placeholder="业务场景 / 主题"
          />
          <n-select
            v-model:value="filters.styleTechnique"
            multiple
            clearable
            max-tag-count="responsive"
            :options="styleOptions"
            placeholder="风格 / 技巧"
          />
          <n-select v-model:value="filters.sortBy" :options="sortOptions" />
        </div>

        <div class="result-meta">
          <span>{{ filtered.items.length }} 条提示词</span>
          <span class="muted">
            {{ allFacets.modality.WORK_LLM }} 工作 ·
            {{ allFacets.modality.IMAGE_GEN }} 生图 ·
            {{ allFacets.modality.VIDEO_GEN }} 生视频
          </span>
        </div>

        <UiEmptyState
          v-if="!store.loading && filtered.items.length === 0"
          :title="store.items.length === 0 ? '提示词库还是空的' : '没有匹配的提示词'"
          :description="store.items.length === 0 ? '新建一条，或从右下角速存当前正在使用的提示词。' : '清空部分筛选条件再试。'"
        >
          <n-button v-if="store.items.length === 0" type="primary" @click="openNew">
            <template #icon><Plus :size="15" /></template>
            新建提示词
          </n-button>
        </UiEmptyState>

        <div v-else class="prompt-grid">
          <n-card v-for="item in filtered.items" :key="item.id" class="prompt-card" size="small">
            <template #header>
              <div class="card-head">
                <span class="modality-mark" :data-modality="item.modality">
                  <component :is="modalityIcon(item)" :size="17" />
                </span>
                <div class="card-title-block">
                  <strong>{{ item.title }}</strong>
                  <span class="muted">
                    {{ PROMPT_MODALITY_LABELS[item.modality] }} · {{ shortDate(item.updatedAt) }}
                  </span>
                </div>
                <n-button
                  quaternary
                  circle
                  size="small"
                  :type="item.isFavorite ? 'warning' : 'default'"
                  title="切换收藏"
                  @click="toggleFavorite(item)"
                >
                  <template #icon><Star :size="15" /></template>
                </n-button>
              </div>
            </template>

            <PromptThumb v-if="item.coverMediaId" :item="item" class="card-thumb" />
            <p class="prompt-preview">{{ previewText(item) }}</p>

            <div class="tag-list">
              <n-tag
                v-for="tag in [...item.facets.domainTheme, ...item.facets.targetTool, ...item.facets.styleTechnique].slice(0, 4)"
                :key="tag"
                size="tiny"
                :bordered="false"
              >
                {{ tag }}
              </n-tag>
              <span class="usage-count">使用 {{ item.usageCount }} 次</span>
            </div>

            <template #footer>
              <div class="card-actions">
                <n-button size="small" @click="openRunner(item)">
                  <template #icon><Play :size="14" /></template>
                  运行
                </n-button>
                <n-button size="small" quaternary title="按默认方言复制" @click="copyDirect(item)">
                  <template #icon><Clipboard :size="14" /></template>
                </n-button>
                <n-button size="small" quaternary title="编辑提示词" @click="openEdit(item)">
                  <template #icon><Pencil :size="14" /></template>
                </n-button>
                <n-button size="small" quaternary title="分享提示词" @click="openShare(item)">
                  <template #icon><Share2 :size="14" /></template>
                </n-button>
                <n-popconfirm @positive-click="remove(item)">
                  <template #trigger>
                    <n-button size="small" quaternary type="error" title="删除提示词">
                      <template #icon><Trash2 :size="14" /></template>
                    </n-button>
                  </template>
                  删除「{{ item.title }}」？
                </n-popconfirm>
              </div>
            </template>
          </n-card>
        </div>
      </n-tab-pane>

      <n-tab-pane name="snippets" tab="词块字典">
        <PromptSnippetDictTab />
      </n-tab-pane>
    </n-tabs>

    <div class="prompt-baseline">
      <Sparkles :size="14" />
      全部提示词与缩略图只存本机 IndexedDB，不发起模型请求。
    </div>

    <PromptEditorModal
      v-model:show="showEditor"
      :item="editingItem"
      @saved="editingItem = null"
    />
    <PromptRunnerDrawer v-model:show="showRunner" :item="runningItem" />
    <PromptShareModal v-model:show="showShare" :item="sharingItem" />
  </div>
</template>

<style scoped>
.prompts-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-6);
}

.filter-panel {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) repeat(5, minmax(130px, 0.7fr));
  gap: var(--space-2);
  padding: var(--space-3) 0;
}

.result-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: var(--space-2) 0 var(--space-4);
  color: var(--app-text);
  font-size: var(--text-sm);
}

.prompt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}

.prompt-card {
  height: 100%;
}

.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.modality-mark {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.modality-mark[data-modality='IMAGE_GEN'] {
  background: var(--type-play-soft);
  color: var(--type-play);
}

.modality-mark[data-modality='VIDEO_GEN'] {
  background: var(--type-stay-soft);
  color: var(--type-stay);
}

.card-title-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title-block strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-title-block .muted {
  font-size: var(--text-xs);
}

.prompt-preview {
  min-height: 74px;
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  color: var(--app-text-secondary);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
  word-break: break-word;
}

.card-thumb {
  margin-bottom: var(--space-3);
}

.tag-list {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
  min-height: 24px;
  margin-top: var(--space-3);
}

.usage-count {
  margin-left: auto;
  color: var(--app-faint);
  font-size: 10px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.card-actions .n-button:first-child {
  margin-right: auto;
}

.prompt-baseline {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-5);
  color: var(--app-faint);
  font-size: var(--text-xs);
}

.muted {
  color: var(--app-muted);
}

@media (max-width: 1040px) {
  .filter-panel {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .prompts-page {
    padding: var(--space-4);
  }

  .filter-panel {
    grid-template-columns: 1fr;
  }

  .result-meta {
    align-items: flex-start;
    flex-direction: column;
  }

  .prompt-grid {
    grid-template-columns: 1fr;
  }
}
</style>
