<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NDrawer,
  NDrawerContent,
  NInput,
  NInputNumber,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import { Clipboard, Minus, Plus } from '@lucide/vue'
import { composePrompt, type PromptComposeTarget } from '../domain/promptComposer'
import { parseTemplateVariables } from '../domain/templateParser'
import {
  PROMPT_MODALITY_LABELS,
  type PromptItem,
  type PromptSnippet,
} from '../schema'
import { usePromptsStore } from '../store'

const props = defineProps<{
  show: boolean
  item?: PromptItem | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const store = usePromptsStore()
const message = useMessage()
const draft = ref<PromptItem | null>(null)
const selectedTarget = ref<PromptComposeTarget>('WORK_PLAIN')
const variableValues = ref<Record<string, string>>({})
const copying = ref(false)

function defaultTarget(item: PromptItem): PromptComposeTarget {
  if (item.modality === 'IMAGE_GEN') return 'Midjourney'
  if (item.modality === 'VIDEO_GEN') return 'VIDEO_ZH'
  return 'WORK_PLAIN'
}

const targetOptions = computed(() => {
  if (draft.value?.modality === 'IMAGE_GEN') {
    return [
      { value: 'Midjourney', label: 'Midjourney' },
      { value: 'SD_POSITIVE', label: 'SD 正向词' },
      { value: 'SD_NEGATIVE', label: 'SD 负向词' },
    ]
  }
  if (draft.value?.modality === 'VIDEO_GEN') {
    return [
      { value: 'VIDEO_ZH', label: '中文视频模型' },
      { value: 'VIDEO_EN', label: '英文视频模型' },
    ]
  }
  return [
    { value: 'WORK_PLAIN', label: '纯文本' },
    { value: 'WORK_MARKDOWN', label: 'Markdown' },
    { value: 'WORK_JSON', label: 'JSON' },
  ]
})

const parsedVariables = computed(() => {
  if (draft.value?.modality !== 'WORK_LLM') return []
  return parseTemplateVariables(draft.value.payload.templateBody).variables
})

const activeSnippets = computed(() => {
  if (draft.value?.modality !== 'IMAGE_GEN') return []
  const snippetsById = new Map(store.snippets.map((snippet) => [snippet.id, snippet]))
  return draft.value.payload.activeSnippets.flatMap((active) => {
    const snippet = snippetsById.get(active.snippetId)
    return snippet ? [{ active, snippet }] : []
  })
})

const preview = computed(() => {
  if (!draft.value || !selectedTarget.value) return ''
  try {
    return composePrompt(draft.value, {
      target: selectedTarget.value,
      variables: variableValues.value,
      snippets: store.snippets,
    })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
})

watch(
  () => [props.show, props.item] as const,
  ([show, item]) => {
    if (!show || !item) return
    // Pinia state is reactive; structuredClone rejects Vue Proxy wrappers.
    draft.value = JSON.parse(JSON.stringify(item)) as PromptItem
    selectedTarget.value = defaultTarget(item)
    const values: Record<string, string> = {}
    if (item.modality === 'WORK_LLM') {
      for (const variable of parseTemplateVariables(item.payload.templateBody).variables) {
        values[variable.name] = variable.defaultValue ?? variable.options?.[0] ?? ''
      }
    }
    variableValues.value = values
  },
  { immediate: true },
)

function toggleSnippet(index: number) {
  if (draft.value?.modality !== 'IMAGE_GEN') return
  const active = draft.value.payload.activeSnippets[index]
  if (active) active.enabled = !active.enabled
}

function changeWeight(index: number, delta: number) {
  if (draft.value?.modality !== 'IMAGE_GEN') return
  const active = draft.value.payload.activeSnippets[index]
  if (!active) return
  active.weight = Math.min(2, Math.max(0.1, Math.round((active.weight + delta) * 10) / 10))
}

function snippetLabel(snippet: PromptSnippet): string {
  return snippet.labelZh || snippet.labelEn || snippet.textEn
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

async function copyPreview() {
  if (!draft.value || !preview.value) return
  copying.value = true
  try {
    await writeClipboard(preview.value)
    await store.incrementUsage(draft.value.id)
    message.success('已复制')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <n-drawer
    :show="show"
    width="min(520px, 100vw)"
    placement="right"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <n-drawer-content v-if="draft">
      <template #header>
        <div class="drawer-title">
          <span>{{ draft.title }}</span>
          <n-tag size="small" :bordered="false">{{ PROMPT_MODALITY_LABELS[draft.modality] }}</n-tag>
        </div>
      </template>

      <div class="runner-body">
        <div class="target-row">
          <span class="field-label">输出方言</span>
          <n-select v-model:value="selectedTarget" :options="targetOptions" size="small" />
        </div>

        <template v-if="draft.modality === 'WORK_LLM'">
          <div v-if="parsedVariables.length === 0" class="hint">
            模板没有变量，可直接复制。
          </div>
          <label v-for="variable in parsedVariables" :key="variable.name" class="variable-field">
            <span>{{ variable.name }}</span>
            <n-select
              v-if="variable.options?.length"
              v-model:value="variableValues[variable.name]"
              :options="variable.options.map((value) => ({ value, label: value }))"
              size="small"
            />
            <n-input
              v-else
              v-model:value="variableValues[variable.name]"
              size="small"
              :placeholder="variable.defaultValue ? `默认：${variable.defaultValue}` : '填写变量'"
            />
          </label>
        </template>

        <template v-else-if="draft.modality === 'IMAGE_GEN'">
          <div v-if="activeSnippets.length === 0" class="hint">
            这条提示词还没有绑定词块，可在编辑器中从字典加入。
          </div>
          <div v-for="(entry, index) in activeSnippets" :key="entry.snippet.id" class="snippet-chip">
            <n-checkbox
              :checked="entry.active.enabled"
              @update:checked="toggleSnippet(index)"
            >
              {{ snippetLabel(entry.snippet) }}
            </n-checkbox>
            <span class="snippet-text">{{ entry.snippet.textEn }}</span>
            <div class="weight-stepper">
              <n-button
                quaternary
                circle
                size="tiny"
                title="降低权重"
                @click="changeWeight(index, -0.1)"
              >
                <template #icon><Minus :size="12" /></template>
              </n-button>
              <n-input-number
                v-model:value="entry.active.weight"
                size="tiny"
                :min="0.1"
                :max="2"
                :step="0.1"
                :show-button="false"
              />
              <n-button
                quaternary
                circle
                size="tiny"
                title="提高权重"
                @click="changeWeight(index, 0.1)"
              >
                <template #icon><Plus :size="12" /></template>
              </n-button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="video-facts">
            <span>{{ draft.payload.videoParams.durationSec ?? 5 }} 秒</span>
            <span>{{ draft.payload.videoParams.aspectRatio ?? '16:9' }}</span>
            <span>{{ draft.payload.videoParams.fps ?? 24 }} FPS</span>
          </div>
        </template>

        <div class="preview-head">
          <span class="field-label">实时预览</span>
          <n-tag v-if="selectedTarget === 'WORK_PLAIN'" size="tiny" :bordered="false">
            未填变量会保留原占位符
          </n-tag>
        </div>
        <pre class="preview">{{ preview }}</pre>
      </div>

      <template #footer>
        <div class="drawer-foot">
          <n-button @click="emit('update:show', false)">关闭</n-button>
          <n-button type="primary" :loading="copying" :disabled="!preview" @click="copyPreview">
            <template #icon><Clipboard :size="15" /></template>
            复制并计次
          </n-button>
        </div>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.drawer-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.drawer-title > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runner-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.target-row {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.field-label,
.variable-field > span {
  color: var(--app-muted);
  font-size: var(--text-xs);
  font-weight: 600;
}

.variable-field {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.hint {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--app-chip-bg);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.snippet-chip {
  display: grid;
  grid-template-columns: minmax(140px, auto) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--app-border);
}

.snippet-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--text-xs);
}

.weight-stepper {
  display: flex;
  align-items: center;
  gap: 2px;
}

.weight-stepper :deep(.n-input-number) {
  width: 62px;
}

.video-facts {
  display: flex;
  gap: var(--space-2);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.preview {
  min-height: 180px;
  max-height: 46vh;
  margin: 0;
  overflow: auto;
  padding: var(--space-3);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-code-bg);
  color: var(--app-text);
  font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 600px) {
  .snippet-chip {
    grid-template-columns: 1fr auto;
  }

  .snippet-text {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
