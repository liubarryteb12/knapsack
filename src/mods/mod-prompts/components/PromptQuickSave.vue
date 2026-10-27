<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import { Plus, Sparkles } from '@lucide/vue'
import { nanoid } from 'nanoid'
import { PROMPT_MODALITY_LABELS, type PromptItem, type PromptModality } from '../schema'
import { usePromptsStore } from '../store'

const store = usePromptsStore()
const message = useMessage()
const show = ref(false)
const saving = ref(false)
const form = ref({
  title: '',
  modality: 'WORK_LLM' as PromptModality,
  body: '',
})

const modalityOptions = Object.entries(PROMPT_MODALITY_LABELS).map(([value, label]) => ({
  value,
  label,
}))

const canSave = computed(() => form.value.title.trim().length > 0 && form.value.body.trim().length > 0)

function open() {
  form.value = {
    title: '',
    modality: 'WORK_LLM',
    body: '',
  }
  show.value = true
}

function buildItem(): PromptItem {
  const now = Date.now()
  const base = {
    id: nanoid(12),
    title: form.value.title.trim(),
    facets: { targetTool: [], domainTheme: [], styleTechnique: [] },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: now,
    updatedAt: now,
  }
  const body = form.value.body.trim()
  if (form.value.modality === 'IMAGE_GEN') {
    return {
      ...base,
      modality: 'IMAGE_GEN',
      payload: {
        positivePrompt: body,
        positivePromptZh: '',
        negativePrompt: '',
        activeSnippets: [],
        imageParams: { targetModel: '', styleRef: '', seed: '' },
      },
    }
  }
  if (form.value.modality === 'VIDEO_GEN') {
    return {
      ...base,
      modality: 'VIDEO_GEN',
      payload: {
        subjectAndScene: body,
        motionDynamics: '',
        cameraMovement: [],
        atmosphereAndLighting: '',
        videoParams: { requiresStartEndFrame: false, frameNotes: '' },
      },
    }
  }
  return {
    ...base,
    modality: 'WORK_LLM',
    payload: {
      systemRole: '',
      templateBody: body,
      fewShotExamples: [],
      outputFormat: 'PLAIN',
    },
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await store.createItem(buildItem())
    show.value = false
    message.success('已速存到提示词库')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <button class="quick-save-trigger" type="button" title="速存好词" @click="open">
    <Sparkles :size="19" />
    <span>速存</span>
  </button>

  <n-modal
    v-model:show="show"
    preset="card"
    title="速存好词"
    style="width: min(560px, calc(100vw - 32px))"
  >
    <div class="quick-form">
      <label>
        标题
        <n-input v-model:value="form.title" placeholder="例如：代码评审 · 风险清单" />
      </label>
      <label>
        模态
        <n-select v-model:value="form.modality" :options="modalityOptions" />
      </label>
      <label>
        内容
        <n-input
          v-model:value="form.body"
          type="textarea"
          :autosize="{ minRows: 7, maxRows: 16 }"
          placeholder="粘贴一条值得复用的提示词"
        />
      </label>
    </div>
    <template #footer>
      <div class="modal-foot">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="!canSave" @click="save">
          <template #icon><Plus :size="15" /></template>
          保存
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.quick-save-trigger {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 15px;
  border: 0;
  border-radius: 999px;
  background: var(--app-accent-solid);
  color: var(--app-accent-on);
  box-shadow: var(--shadow-lg);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.quick-save-trigger:hover {
  filter: brightness(1.08);
}

.quick-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.quick-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 720px) {
  .quick-save-trigger {
    position: static;
    width: auto;
    min-height: 34px;
    justify-content: center;
    padding: 0 14px;
    box-shadow: none;
  }

  .quick-save-trigger span {
    display: inline;
  }
}
</style>
