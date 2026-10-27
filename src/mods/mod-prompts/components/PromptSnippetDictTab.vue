<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import { Download, Pencil, Plus, Trash2, Upload } from '@lucide/vue'
import { nanoid } from 'nanoid'
import {
  promptSnippetSchema,
  type PromptSnippet,
  type PromptSnippetCategory,
} from '../schema'
import { usePromptsStore } from '../store'

const store = usePromptsStore()
const message = useMessage()
const show = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const importInput = ref<HTMLInputElement | null>(null)

const categoryOptions: Array<{ value: PromptSnippetCategory; label: string }> = [
  { value: 'STYLE', label: '风格' },
  { value: 'LIGHTING', label: '光影' },
  { value: 'SHOT', label: '镜头' },
  { value: 'QUALITY', label: '画质' },
  { value: 'CAMERA', label: '运镜' },
  { value: 'PARAM', label: '参数' },
]

const form = reactive({
  category: 'STYLE' as PromptSnippetCategory,
  labelZh: '',
  labelEn: '',
  textEn: '',
  defaultWeight: 1,
})

function open(snippet?: PromptSnippet) {
  editingId.value = snippet?.id ?? null
  form.category = snippet?.category ?? 'STYLE'
  form.labelZh = snippet?.labelZh ?? ''
  form.labelEn = snippet?.labelEn ?? ''
  form.textEn = snippet?.textEn ?? ''
  form.defaultWeight = snippet?.defaultWeight ?? 1
  show.value = true
}

async function save() {
  saving.value = true
  try {
    const current = store.snippets.find((snippet) => snippet.id === editingId.value)
    const now = Date.now()
    const snippet = promptSnippetSchema.parse({
      id: current?.id ?? nanoid(10),
      category: form.category,
      labelZh: form.labelZh.trim(),
      labelEn: form.labelEn.trim(),
      textEn: form.textEn.trim(),
      defaultWeight: form.defaultWeight,
      usageCount: current?.usageCount ?? 0,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    })
    await store.saveSnippet(snippet)
    show.value = false
    message.success('词块已保存')
  } catch (e) {
    const issue = e && typeof e === 'object' && 'issues' in e
      ? (e as { issues?: Array<{ message?: string }> }).issues?.[0]?.message
      : undefined
    message.error(issue || (e instanceof Error ? e.message : String(e)))
  } finally {
    saving.value = false
  }
}

async function remove(snippet: PromptSnippet) {
  try {
    await store.removeSnippet(snippet.id)
    message.success('词块已删除')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

function categoryLabel(category: PromptSnippetCategory): string {
  return categoryOptions.find((option) => option.value === category)?.label ?? category
}

function exportSnippets() {
  const body = [
    '# Knapsack Prompt Snippets',
    '',
    ...store.snippets.map(
      (snippet) =>
        `- [${snippet.category}] ${snippet.labelZh} | ${snippet.textEn}`,
    ),
    '',
  ].join('\n')
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `knapsack-prompt-snippets-${new Date().toISOString().slice(0, 10)}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}

function parseImportedSnippets(text: string): PromptSnippet[] {
  const now = Date.now()
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && 'snippets' in parsed
        ? (parsed as { snippets: unknown }).snippets
        : null
    if (!Array.isArray(rows)) throw new Error('JSON 中没有 snippets 数组')
    return rows.map((row) => promptSnippetSchema.parse(row))
  }

  const rows: PromptSnippet[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(
      /^\s*[-*]\s*\[(STYLE|LIGHTING|SHOT|QUALITY|CAMERA|PARAM)\]\s*(.+?)\s*\|\s*(.+?)\s*$/,
    )
    if (!match) continue
    rows.push(
      promptSnippetSchema.parse({
        id: nanoid(10),
        category: match[1],
        labelZh: match[2],
        labelEn: '',
        textEn: match[3],
        defaultWeight: 1,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  if (rows.length === 0) throw new Error('没有识别到合法词块')
  return rows
}

async function importSnippets(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const snippets = parseImportedSnippets(await file.text())
    for (const snippet of snippets) await store.saveSnippet(snippet)
    message.success(`已导入 ${snippets.length} 个词块`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="snippet-panel">
    <div class="snippet-toolbar">
      <div>
        <strong>常用词块</strong>
        <span class="muted">画风、光影、镜头、画质与运镜片段</span>
      </div>
      <div class="snippet-actions">
        <n-button size="small" :disabled="store.snippets.length === 0" @click="exportSnippets">
          <template #icon><Download :size="15" /></template>
          导出
        </n-button>
        <n-button size="small" @click="importInput?.click()">
          <template #icon><Upload :size="15" /></template>
          导入
        </n-button>
        <n-button type="primary" size="small" @click="open()">
          <template #icon><Plus :size="15" /></template>
          新建词块
        </n-button>
        <input
          ref="importInput"
          class="hidden-input"
          type="file"
          accept=".json,.md,.markdown,.txt"
          @change="importSnippets"
        />
      </div>
    </div>

    <div v-if="store.snippets.length === 0" class="empty">
      还没有词块。先收录一个常用后缀，之后可在生图和生视频提示词里快速拼接。
    </div>

    <div v-for="snippet in store.snippets" :key="snippet.id" class="snippet-row">
      <n-tag size="small" :bordered="false">{{ categoryLabel(snippet.category) }}</n-tag>
      <div class="snippet-main">
        <strong>{{ snippet.labelZh }}</strong>
        <span class="muted mono">{{ snippet.textEn }}</span>
      </div>
      <span class="weight">×{{ snippet.defaultWeight.toFixed(1) }}</span>
      <n-button quaternary circle size="small" title="编辑词块" @click="open(snippet)">
        <template #icon><Pencil :size="15" /></template>
      </n-button>
      <n-popconfirm @positive-click="remove(snippet)">
        <template #trigger>
          <n-button quaternary circle size="small" type="error" title="删除词块">
            <template #icon><Trash2 :size="15" /></template>
          </n-button>
        </template>
        删除「{{ snippet.labelZh }}」？
      </n-popconfirm>
    </div>

    <n-modal
      v-model:show="show"
      preset="card"
      :title="editingId ? '编辑词块' : '新建词块'"
      style="width: min(520px, calc(100vw - 32px))"
    >
      <div class="snippet-form">
        <label>
          <span>类别</span>
          <n-select v-model:value="form.category" :options="categoryOptions" />
        </label>
        <label>
          <span>中文名</span>
          <n-input v-model:value="form.labelZh" placeholder="例如：电影侧逆光" />
        </label>
        <label>
          <span>英文标签</span>
          <n-input v-model:value="form.labelEn" placeholder="cinematic rim light" />
        </label>
        <label>
          <span>拼接文本</span>
          <n-input v-model:value="form.textEn" type="textarea" :rows="3" />
        </label>
        <label class="weight-field">
          <span>默认权重</span>
          <n-input-number v-model:value="form.defaultWeight" :min="0.1" :max="2" :step="0.1" />
        </label>
      </div>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="show = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.snippet-panel {
  min-height: 280px;
}

.snippet-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) 0 var(--space-4);
}

.snippet-toolbar > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.snippet-actions {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: var(--space-2) !important;
}

.snippet-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--app-border);
}

.snippet-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.snippet-main .mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--text-xs);
}

.weight {
  color: var(--app-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.empty {
  padding: var(--space-8) var(--space-3);
  color: var(--app-muted-soft);
  text-align: center;
}

.snippet-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.snippet-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.weight-field {
  max-width: 180px;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.hidden-input {
  display: none;
}

@media (max-width: 640px) {
  .snippet-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
