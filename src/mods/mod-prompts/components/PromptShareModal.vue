<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NModal, useMessage } from 'naive-ui'
import { Clipboard, Download } from '@lucide/vue'
import type { PromptItem } from '../schema'
import {
  decodePromptShareLink,
  encodePromptShareLink,
} from '../shareLink'
import { usePromptsStore } from '../store'

const props = defineProps<{
  show: boolean
  item?: PromptItem | null
  initialImport?: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const store = usePromptsStore()
const message = useMessage()
const shareLink = ref('')
const shareError = ref('')
const importLink = ref('')
const importing = ref(false)
const incomingTitle = ref('')
let shareSequence = 0

const longLink = computed(() => shareLink.value.length > 16_000)

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value)
    message.success(success)
  } catch {
    message.error('复制失败，请手动选择链接')
  }
}

async function importShared() {
  if (!importLink.value.trim()) return
  importing.value = true
  try {
    const item = await decodePromptShareLink(importLink.value)
    await store.createItem(item)
    importLink.value = ''
    incomingTitle.value = ''
    emit('update:show', false)
    message.success(`已导入「${item.title}」`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    importing.value = false
  }
}

watch(
  () => [props.show, props.item, props.initialImport] as const,
  async ([show, item, initialImport]) => {
    const sequence = ++shareSequence
    shareLink.value = ''
    shareError.value = ''
    incomingTitle.value = ''
    if (!show) return
    if (initialImport?.trim()) importLink.value = initialImport.trim()
    if (!item) return
    try {
      const value = await encodePromptShareLink(item)
      if (sequence === shareSequence) shareLink.value = value
    } catch (e) {
      if (sequence === shareSequence) {
        shareError.value = e instanceof Error ? e.message : String(e)
      }
    }
  },
  { immediate: true },
)

watch(
  () => props.initialImport,
  async (value) => {
    if (!value?.trim()) {
      incomingTitle.value = ''
      return
    }
    try {
      incomingTitle.value = (await decodePromptShareLink(value)).title
    } catch {
      incomingTitle.value = ''
    }
  },
  { immediate: true },
)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="item ? '分享提示词' : '导入提示词'"
    style="width: min(660px, calc(100vw - 32px))"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div v-if="item" class="share-body">
      <div class="share-heading">
        <strong>{{ item.title }}</strong>
        <p class="muted">
          提示词内容已压缩进链接，只包含正文和标签，不含本机 ID、收藏、调用次数、历史和参考图。
        </p>
      </div>
      <n-alert v-if="shareError" type="error" :bordered="false">
        {{ shareError }}
      </n-alert>
      <n-alert v-else-if="longLink" type="warning" :bordered="false">
        这条提示词很长，分享链接也会很长。部分聊天软件可能折叠链接，请完整复制发送。
      </n-alert>
      <n-input
        :value="shareLink"
        type="textarea"
        :rows="4"
        readonly
        placeholder="正在生成分享链接…"
      />
      <div class="share-actions">
        <n-button
          type="primary"
          :disabled="!shareLink"
          @click="copyText(shareLink, '分享链接已复制')"
        >
          <template #icon><Clipboard :size="15" /></template>
          复制分享链接
        </n-button>
      </div>
    </div>

    <div class="import-body">
      <div class="import-head">
        <strong>粘贴分享链接</strong>
        <span class="muted">支持行囊分享链接，也兼容旧分享码</span>
      </div>
      <n-alert v-if="incomingTitle" type="info" :bordered="false">
        即将导入「{{ incomingTitle }}」，确认后会保存到本机提示词库。
      </n-alert>
      <n-input
        v-model:value="importLink"
        type="textarea"
        :rows="4"
        placeholder="粘贴 knapsack-prompt://share?d=…"
      />
      <div class="import-actions">
        <n-button @click="emit('update:show', false)">关闭</n-button>
        <n-button
          type="primary"
          :loading="importing"
          :disabled="!importLink.trim()"
          @click="importShared"
        >
          <template #icon><Download :size="15" /></template>
          导入到本机
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.share-body,
.import-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.share-heading strong {
  font-size: var(--text-lg);
}

.share-heading p {
  margin: 4px 0 0;
  font-size: var(--text-xs);
}

.share-actions,
.import-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.import-body {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--app-border);
}

.import-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.import-head .muted,
.muted {
  color: var(--app-muted);
  font-size: var(--text-xs);
}
</style>
