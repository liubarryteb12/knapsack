<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NModal, useMessage } from 'naive-ui'
import QRCode from 'qrcode'
import { Clipboard, Download } from '@lucide/vue'
import type { PromptItem } from '../schema'
import { decodePromptShare, encodePromptShare } from '../shareCode'
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
const qrUrl = ref('')
const importCode = ref('')
const importing = ref(false)
let qrSequence = 0

const code = computed(() => (props.item ? encodePromptShare(props.item) : ''))
const dense = computed(() => code.value.length > 1400)

watch(
  () => [props.show, code.value] as const,
  async ([show, value]) => {
    if (!show || !value) {
      qrUrl.value = ''
      return
    }
    const sequence = ++qrSequence
    const url = await QRCode.toDataURL(value, {
      width: 340,
      margin: 1,
      errorCorrectionLevel: 'L',
    })
    if (sequence === qrSequence) qrUrl.value = url
  },
  { immediate: true },
)

async function copyCode() {
  try {
    await navigator.clipboard.writeText(code.value)
    message.success('分享码已复制')
  } catch {
    message.error('复制失败，请手动选择文本')
  }
}

async function importShared() {
  if (!importCode.value.trim()) return
  importing.value = true
  try {
    const item = decodePromptShare(importCode.value)
    await store.createItem(item)
    importCode.value = ''
    emit('update:show', false)
    message.success(`已导入「${item.title}」`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="item ? '分享提示词' : '导入提示词分享码'"
    style="width: min(620px, calc(100vw - 32px))"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div v-if="item" class="share-body">
      <div class="qr-wrap">
        <img v-if="qrUrl" :src="qrUrl" class="qr" alt="提示词分享二维码" />
        <span v-else class="qr-placeholder">正在生成二维码…</span>
      </div>
      <div class="share-copy">
        <strong>{{ item.title }}</strong>
        <p class="muted">
          只分享提示词内容与标签，不包含本机 ID、收藏、调用次数、历史和参考图。
        </p>
        <n-alert v-if="dense" type="warning" :bordered="false">
          内容较长，二维码可能较密；若对方扫码困难，请复制下方分享码发送。
        </n-alert>
        <n-input :value="code" type="textarea" :rows="3" readonly />
        <n-button size="small" @click="copyCode">
          <template #icon><Clipboard :size="15" /></template>
          复制分享码
        </n-button>
      </div>
    </div>

    <div class="import-body">
      <div class="import-head">
        <strong>导入分享码</strong>
        <span class="muted">支持粘贴对方复制的内容</span>
      </div>
      <n-input
        v-model:value="importCode"
        type="textarea"
        :rows="4"
        placeholder="knapsack-prompt/1?d=…"
      />
      <div class="import-actions">
        <n-button @click="emit('update:show', false)">关闭</n-button>
        <n-button
          type="primary"
          :loading="importing"
          :disabled="!importCode.trim()"
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
.share-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

.qr-wrap {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: #fff;
  overflow: hidden;
}

.qr {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.qr-placeholder {
  color: #667085;
  font-size: 12px;
}

.share-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.share-copy strong {
  font-size: var(--text-lg);
}

.share-copy p {
  margin: 0;
  font-size: var(--text-xs);
}

.import-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--app-border);
}

.import-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.import-head .muted {
  font-size: var(--text-xs);
}

.import-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.muted {
  color: var(--app-muted);
}

@media (max-width: 680px) {
  .share-body {
    grid-template-columns: 1fr;
  }

  .qr-wrap {
    width: min(280px, 100%);
    margin: 0 auto;
  }
}
</style>
