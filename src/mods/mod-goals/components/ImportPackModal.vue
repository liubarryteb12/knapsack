<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NModal, useMessage } from 'naive-ui'
import { ClipboardPaste } from '@lucide/vue'
import PackPreview from './PackPreview.vue'
import {
  buildImportPlan,
  commitImport,
  findPreviousImport,
  loadLocalSnapshot,
  parseGoalPackText,
  type ImportPlan,
  type ImportRecord,
} from '../services/parseGoalPack'
import { useGoalsStore } from '../store'

const props = defineProps<{
  show: boolean
  promptVersion?: number
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  imported: [plan: ImportPlan]
}>()

const store = useGoalsStore()
const message = useMessage()

const visible = computed({
  get: () => props.show,
  set: (value: boolean) => emit('update:show', value),
})

const text = ref('')
const plan = ref<ImportPlan | null>(null)
const previous = ref<ImportRecord | null>(null)
const error = ref('')
const busy = ref(false)
const force = ref(false)

watch(
  () => props.show,
  (show) => {
    if (!show) {
      plan.value = null
      previous.value = null
      error.value = ''
      force.value = false
    }
  },
)

async function pasteFromClipboard() {
  try {
    const value = await navigator.clipboard.readText()
    if (value.trim()) {
      text.value = value
      message.success('已从剪贴板粘贴')
    } else {
      message.warning('剪贴板是空的')
    }
  } catch {
    message.warning('浏览器不允许读取剪贴板，请手动粘贴')
  }
}

async function preview() {
  error.value = ''
  busy.value = true
  try {
    const pack = parseGoalPackText(text.value)
    const local = await loadLocalSnapshot()
    plan.value = await buildImportPlan(pack, local)
    previous.value = (await findPreviousImport(plan.value.idempotencyKey)) ?? null
  } catch (err) {
    plan.value = null
    previous.value = null
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function confirmImport() {
  if (!plan.value) return
  if (previous.value && !force.value) {
    force.value = true
    return
  }
  busy.value = true
  try {
    await commitImport(plan.value, { promptVersion: props.promptVersion })
    await store.loadAll()
    message.success('导入完成')
    emit('imported', plan.value)
    visible.value = false
    text.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

function backToEdit() {
  plan.value = null
  previous.value = null
  force.value = false
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="导入 goal-pack" style="max-width: 720px">
    <div class="import-body">
      <template v-if="!plan">
        <p class="import-hint">
          粘贴 Claude Desktop 或其他 AI 产出的 goal-pack，解析后先预览，确认才会写库。
        </p>
        <n-input
          v-model:value="text"
          type="textarea"
          placeholder="粘贴包含 goal-pack.v1 的 JSON 或代码块"
          :autosize="{ minRows: 8, maxRows: 18 }"
        />
        <div class="import-tools">
          <n-button size="small" @click="pasteFromClipboard">
            <template #icon><ClipboardPaste :size="14" /></template>
            从剪贴板粘贴
          </n-button>
        </div>
        <n-alert v-if="error" type="error" :bordered="false" class="import-error">{{ error }}</n-alert>
      </template>

      <template v-else>
        <n-alert v-if="previous" type="warning" :bordered="false" class="import-error">
          该包已于 {{ new Date(previous.importedAt).toLocaleString('zh-CN') }} 导入过。
          {{ force ? '再次确认将更新内容字段，不会覆盖本地状态。' : '如仍要导入，请再点一次确认。' }}
        </n-alert>
        <n-alert v-if="error" type="error" :bordered="false" class="import-error">{{ error }}</n-alert>
        <PackPreview :plan="plan" />
      </template>
    </div>

    <template #footer>
      <div class="import-footer">
        <template v-if="!plan">
          <n-button @click="visible = false">取消</n-button>
          <n-button type="primary" :loading="busy" :disabled="!text.trim()" @click="preview">
            解析并预览
          </n-button>
        </template>
        <template v-else>
          <n-button @click="backToEdit">返回修改</n-button>
          <n-button type="primary" :loading="busy" @click="confirmImport">
            {{ previous && !force ? '仍然导入' : '确认导入' }}
          </n-button>
        </template>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.import-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.import-hint {
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.import-tools {
  display: flex;
  justify-content: flex-end;
}

.import-error {
  white-space: pre-wrap;
}

.import-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
