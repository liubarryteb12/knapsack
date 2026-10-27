<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  useMessage,
} from 'naive-ui'
import { Save } from '@lucide/vue'
import { ImagePlus, X } from '@lucide/vue'
import { nanoid } from 'nanoid'
import {
  CAMERA_MOVEMENT_LABELS,
  CAMERA_MOVEMENTS,
  OUTPUT_FORMAT_LABELS,
  PROMPT_MODALITY_LABELS,
  promptItemSchema,
  type PromptItem,
  type PromptMediaRecord,
  type PromptModality,
  type PromptSnippetRef,
} from '../schema'
import { compressThumbnail } from '../services/thumbnailCompressor'
import { usePromptsStore } from '../store'

const props = defineProps<{
  show: boolean
  item?: PromptItem | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: [item: PromptItem]
}>()

const store = usePromptsStore()
const message = useMessage()
const saving = computed(() => store.saving)
const fileInput = ref<HTMLInputElement | null>(null)
const pendingMedia = ref<PromptMediaRecord | null>(null)
const clearCover = ref(false)
const coverPreview = ref('')
const compressing = ref(false)
const activeSnippets = ref<PromptSnippetRef[]>([])
let previewObjectUrl = ''

const modalityOptions = Object.entries(PROMPT_MODALITY_LABELS).map(([value, label]) => ({
  value,
  label,
}))
const formatOptions = Object.entries(OUTPUT_FORMAT_LABELS).map(([value, label]) => ({
  value,
  label,
}))
const cameraOptions = CAMERA_MOVEMENTS.map((value) => ({
  value,
  label: CAMERA_MOVEMENT_LABELS[value],
}))

const form = reactive({
  title: '',
  modality: 'WORK_LLM' as PromptModality,
  targetTools: '',
  themes: '',
  styles: '',
  isFavorite: false,
  systemRole: '',
  templateBody: '',
  outputFormat: 'PLAIN',
  positivePrompt: '',
  positivePromptZh: '',
  negativePrompt: '',
  aspectRatio: '16:9',
  targetModel: '',
  styleRef: '',
  seed: '',
  subjectAndScene: '',
  motionDynamics: '',
  cameraMovement: [] as Array<(typeof CAMERA_MOVEMENTS)[number]>,
  atmosphereAndLighting: '',
  durationSec: 5,
  fps: 24,
  frameNotes: '',
})

function csv(values: readonly string[]): string {
  return values.join(', ')
}

function parseCsv(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))]
}

function cleanupCoverPreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
  previewObjectUrl = ''
  coverPreview.value = ''
}

async function showExistingCover(item?: PromptItem | null) {
  cleanupCoverPreview()
  if (item?.modality !== 'IMAGE_GEN' || !item.coverMediaId) return
  const media = (await store.loadMedia(item.id)).find((row) => row.mediaId === item.coverMediaId)
  if (!media) return
  previewObjectUrl = URL.createObjectURL(media.blob)
  coverPreview.value = previewObjectUrl
}

function hydrate(item?: PromptItem | null) {
  pendingMedia.value = null
  clearCover.value = false
  activeSnippets.value =
    item?.modality === 'IMAGE_GEN'
      ? item.payload.activeSnippets.map((ref) => ({ ...ref }))
      : []
  void showExistingCover(item)
  form.title = item?.title ?? ''
  form.modality = item?.modality ?? 'WORK_LLM'
  form.targetTools = csv(item?.facets.targetTool ?? [])
  form.themes = csv(item?.facets.domainTheme ?? [])
  form.styles = csv(item?.facets.styleTechnique ?? [])
  form.isFavorite = item?.isFavorite ?? false
  form.systemRole = item?.modality === 'WORK_LLM' ? item.payload.systemRole : ''
  form.templateBody = item?.modality === 'WORK_LLM' ? item.payload.templateBody : ''
  form.outputFormat = item?.modality === 'WORK_LLM' ? item.payload.outputFormat : 'PLAIN'
  form.positivePrompt = item?.modality === 'IMAGE_GEN' ? item.payload.positivePrompt : ''
  form.positivePromptZh = item?.modality === 'IMAGE_GEN' ? item.payload.positivePromptZh : ''
  form.negativePrompt = item?.modality === 'IMAGE_GEN' ? item.payload.negativePrompt : ''
  form.aspectRatio =
    item?.modality === 'IMAGE_GEN'
      ? item.payload.imageParams.aspectRatio ?? '16:9'
      : '16:9'
  form.targetModel = item?.modality === 'IMAGE_GEN' ? item.payload.imageParams.targetModel : ''
  form.styleRef = item?.modality === 'IMAGE_GEN' ? item.payload.imageParams.styleRef : ''
  form.seed = item?.modality === 'IMAGE_GEN' ? item.payload.imageParams.seed : ''
  form.subjectAndScene = item?.modality === 'VIDEO_GEN' ? item.payload.subjectAndScene : ''
  form.motionDynamics = item?.modality === 'VIDEO_GEN' ? item.payload.motionDynamics : ''
  form.cameraMovement =
    item?.modality === 'VIDEO_GEN' ? [...item.payload.cameraMovement] : []
  form.atmosphereAndLighting =
    item?.modality === 'VIDEO_GEN' ? item.payload.atmosphereAndLighting : ''
  form.durationSec =
    item?.modality === 'VIDEO_GEN' ? item.payload.videoParams.durationSec ?? 5 : 5
  form.fps = item?.modality === 'VIDEO_GEN' ? item.payload.videoParams.fps ?? 24 : 24
  form.frameNotes = item?.modality === 'VIDEO_GEN' ? item.payload.videoParams.frameNotes : ''
}

watch(
  () => [props.show, props.item] as const,
  ([show]) => {
    if (show) hydrate(props.item)
  },
  { immediate: true },
)

function baseItem() {
  const now = Date.now()
  return {
    id: props.item?.id ?? nanoid(12),
    title: form.title.trim(),
    facets: {
      targetTool: parseCsv(form.targetTools),
      domainTheme: parseCsv(form.themes),
      styleTechnique: parseCsv(form.styles),
    },
    isFavorite: form.isFavorite,
    usageCount: props.item?.usageCount ?? 0,
    version: props.item?.version ?? 1,
    history: props.item?.history ?? [],
    coverMediaId: clearCover.value
      ? undefined
      : pendingMedia.value?.mediaId ?? props.item?.coverMediaId,
    createdAt: props.item?.createdAt ?? now,
    updatedAt: now,
  }
}

function buildItem(): PromptItem {
  if (form.modality === 'IMAGE_GEN') {
    return {
      ...baseItem(),
      modality: 'IMAGE_GEN',
      payload: {
        positivePrompt: form.positivePrompt.trim(),
        positivePromptZh: form.positivePromptZh.trim(),
        negativePrompt: form.negativePrompt.trim(),
        activeSnippets: activeSnippets.value.map((ref) => ({ ...ref })),
        imageParams: {
          aspectRatio: form.aspectRatio as '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9',
          targetModel: form.targetModel.trim(),
          styleRef: form.styleRef.trim(),
          seed: form.seed.trim(),
        },
      },
    }
  }
  if (form.modality === 'VIDEO_GEN') {
    return {
      ...baseItem(),
      modality: 'VIDEO_GEN',
      payload: {
        subjectAndScene: form.subjectAndScene.trim(),
        motionDynamics: form.motionDynamics.trim(),
        cameraMovement: [...form.cameraMovement],
        atmosphereAndLighting: form.atmosphereAndLighting.trim(),
        videoParams: {
          durationSec: form.durationSec as 5 | 10 | 15,
          aspectRatio: form.aspectRatio as '16:9' | '9:16' | '21:9',
          fps: form.fps,
          requiresStartEndFrame: false,
          frameNotes: form.frameNotes.trim(),
        },
      },
    }
  }
  return {
    ...baseItem(),
    modality: 'WORK_LLM',
    payload: {
      systemRole: form.systemRole.trim(),
      templateBody: form.templateBody.trim(),
      fewShotExamples: props.item?.modality === 'WORK_LLM' ? props.item.payload.fewShotExamples : [],
      outputFormat:
        form.outputFormat as 'MARKDOWN' | 'JSON' | 'TABLE' | 'CODE' | 'PLAIN',
    },
  }
}

function activeSnippet(snippetId: string): PromptSnippetRef | undefined {
  return activeSnippets.value.find((ref) => ref.snippetId === snippetId)
}

function toggleSnippet(snippetId: string, enabled: boolean) {
  if (enabled && !activeSnippet(snippetId)) {
    const snippet = store.snippets.find((row) => row.id === snippetId)
    activeSnippets.value.push({
      snippetId,
      enabled: true,
      weight: snippet?.defaultWeight ?? 1,
    })
    return
  }
  activeSnippets.value = activeSnippets.value.filter((ref) => ref.snippetId !== snippetId)
}

function setSnippetWeight(snippetId: string, weight: number) {
  const ref = activeSnippet(snippetId)
  if (ref) ref.weight = weight
}

async function onCoverPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  compressing.value = true
  try {
    const result = await compressThumbnail(file)
    cleanupCoverPreview()
    previewObjectUrl = URL.createObjectURL(result.blob)
    coverPreview.value = previewObjectUrl
    pendingMedia.value = {
      mediaId: nanoid(12),
      itemId: null,
      blob: result.blob,
      mimeType: 'image/webp',
      byteLength: result.byteLength,
      longEdge: result.longEdge,
      createdAt: Date.now(),
    }
    clearCover.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    compressing.value = false
  }
}

function removeCover() {
  pendingMedia.value = null
  clearCover.value = true
  cleanupCoverPreview()
}

async function save() {
  try {
    const item = promptItemSchema.parse(buildItem())
    const saved = props.item ? await store.updateItem(item) : await store.createItem(item)
    if (pendingMedia.value) {
      await store.saveMedia({ ...pendingMedia.value, itemId: saved.id })
    }
    if (
      props.item?.coverMediaId &&
      (clearCover.value || pendingMedia.value) &&
      props.item.coverMediaId !== saved.coverMediaId
    ) {
      await store.removeMedia(props.item.coverMediaId)
    }
    emit('saved', saved)
    emit('update:show', false)
    message.success('提示词已保存')
  } catch (e) {
    const issue = e && typeof e === 'object' && 'issues' in e
      ? (e as { issues?: Array<{ message?: string }> }).issues?.[0]?.message
      : undefined
    message.error(issue || (e instanceof Error ? e.message : String(e)))
  }
}

onBeforeUnmount(cleanupCoverPreview)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="item ? '编辑提示词' : '新建提示词'"
    style="width: min(760px, calc(100vw - 32px))"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="editor-form">
      <div class="field-grid">
        <label class="wide">
          <span>标题</span>
          <n-input v-model:value="form.title" placeholder="这条提示词解决什么问题" />
        </label>
        <label>
          <span>模态</span>
          <n-select v-model:value="form.modality" :options="modalityOptions" />
        </label>
        <label class="favorite-field">
          <span>优先显示</span>
          <n-checkbox v-model:checked="form.isFavorite">收藏</n-checkbox>
        </label>
        <label>
          <span>适用工具</span>
          <n-input v-model:value="form.targetTools" placeholder="Claude, GPT, Midjourney" />
        </label>
        <label>
          <span>业务场景 / 主题</span>
          <n-input v-model:value="form.themes" placeholder="架构设计, 写实人像" />
        </label>
        <label>
          <span>风格 / 技巧</span>
          <n-input v-model:value="form.styles" placeholder="Few-Shot, 电影质感" />
        </label>
      </div>

      <template v-if="form.modality === 'WORK_LLM'">
        <label>
          <span>System Role</span>
          <n-input
            v-model:value="form.systemRole"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="系统人设（可选）"
          />
        </label>
        <label>
          <span>模板正文</span>
          <n-input
            v-model:value="form.templateBody"
            type="textarea"
            :autosize="{ minRows: 7, maxRows: 16 }"
            placeholder="支持 {{变量}}、{{变量:默认值}}、{{变量:A|B|C}}"
          />
        </label>
        <label class="short-field">
          <span>输出格式</span>
          <n-select v-model:value="form.outputFormat" :options="formatOptions" />
        </label>
      </template>

      <template v-else-if="form.modality === 'IMAGE_GEN'">
        <div class="cover-field">
          <span>效果参考图</span>
          <div class="cover-control">
            <img v-if="coverPreview" class="cover-preview" :src="coverPreview" alt="缩略图预览" />
            <div v-else class="cover-empty">WebP 缩略图，长边不超过 600px，体积不超过 150KB</div>
            <div class="cover-actions">
              <n-button size="small" :loading="compressing" @click="fileInput?.click()">
                <template #icon><ImagePlus :size="15" /></template>
                选择图片
              </n-button>
              <n-button
                v-if="coverPreview"
                size="small"
                quaternary
                type="error"
                @click="removeCover"
              >
                <template #icon><X :size="15" /></template>
                移除
              </n-button>
            </div>
          </div>
          <input
            ref="fileInput"
            class="hidden-input"
            type="file"
            accept="image/*"
            @change="onCoverPicked"
          />
        </div>
        <label>
          <span>正向提示词</span>
          <n-input
            v-model:value="form.positivePrompt"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 12 }"
            placeholder="主体、构图、光线、风格"
          />
        </label>
        <label>
          <span>中文对照</span>
          <n-input v-model:value="form.positivePromptZh" type="textarea" :rows="2" />
        </label>
        <label>
          <span>负向提示词</span>
          <n-input v-model:value="form.negativePrompt" type="textarea" :rows="2" />
        </label>
        <div v-if="store.snippets.length > 0" class="snippet-picker">
          <span>拼接词块</span>
          <div v-for="snippet in store.snippets" :key="snippet.id" class="snippet-choice">
            <n-checkbox
              :checked="!!activeSnippet(snippet.id)"
              @update:checked="(checked: boolean) => toggleSnippet(snippet.id, checked)"
            >
              {{ snippet.labelZh }}
            </n-checkbox>
            <span class="snippet-copy">{{ snippet.textEn }}</span>
            <n-input-number
              v-if="activeSnippet(snippet.id)"
              :value="activeSnippet(snippet.id)?.weight"
              size="tiny"
              :min="0.1"
              :max="2"
              :step="0.1"
              :show-button="false"
              @update:value="(value: number | null) => setSnippetWeight(snippet.id, value ?? 1)"
            />
          </div>
        </div>
        <div class="field-grid">
          <label>
            <span>比例</span>
            <n-select
              v-model:value="form.aspectRatio"
              :options="['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'].map((value) => ({ value, label: value }))"
            />
          </label>
          <label>
            <span>目标模型</span>
            <n-input v-model:value="form.targetModel" placeholder="Midjourney / Flux / SDXL" />
          </label>
          <label>
            <span>Style Ref</span>
            <n-input v-model:value="form.styleRef" placeholder="--sref 或风格说明" />
          </label>
          <label>
            <span>Seed</span>
            <n-input v-model:value="form.seed" placeholder="可留空" />
          </label>
        </div>
      </template>

      <template v-else>
        <label>
          <span>主体与场景</span>
          <n-input v-model:value="form.subjectAndScene" type="textarea" :rows="3" />
        </label>
        <label>
          <span>动作与时间演变</span>
          <n-input v-model:value="form.motionDynamics" type="textarea" :rows="3" />
        </label>
        <label>
          <span>运镜</span>
          <n-select v-model:value="form.cameraMovement" multiple :options="cameraOptions" />
        </label>
        <label>
          <span>光影与氛围</span>
          <n-input v-model:value="form.atmosphereAndLighting" type="textarea" :rows="2" />
        </label>
        <div class="field-grid">
          <label>
            <span>时长</span>
            <n-select
              v-model:value="form.durationSec"
              :options="[5, 10, 15].map((value) => ({ value, label: `${value} 秒` }))"
            />
          </label>
          <label>
            <span>画幅</span>
            <n-select
              v-model:value="form.aspectRatio"
              :options="['16:9', '9:16', '21:9'].map((value) => ({ value, label: value }))"
            />
          </label>
          <label>
            <span>帧率</span>
            <n-input-number v-model:value="form.fps" :min="1" :max="120" />
          </label>
        </div>
        <label>
          <span>首尾帧说明</span>
          <n-input v-model:value="form.frameNotes" type="textarea" :rows="2" />
        </label>
      </template>
    </div>

    <template #footer>
      <div class="modal-foot">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" :loading="saving" @click="save">
          <template #icon><Save :size="15" /></template>
          保存
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.editor-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: min(68vh, 720px);
  overflow-y: auto;
  padding-right: 4px;
}

.editor-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.field-grid .wide {
  grid-column: 1 / -1;
}

.cover-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.cover-control {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.cover-preview {
  width: 160px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-md);
  background: var(--app-chip-bg);
}

.cover-empty {
  flex: 1;
  min-height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-md);
  color: var(--app-muted-soft);
  font-size: var(--text-xs);
  text-align: center;
}

.cover-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.snippet-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.snippet-choice {
  display: grid;
  grid-template-columns: minmax(150px, auto) minmax(0, 1fr) 70px;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--app-border);
}

.snippet-copy {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--text-xs);
}

.hidden-input {
  display: none;
}

.favorite-field {
  justify-content: flex-end;
}

.short-field {
  max-width: 260px;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 640px) {
  .field-grid {
    grid-template-columns: 1fr;
  }

  .field-grid .wide {
    grid-column: auto;
  }

  .short-field {
    max-width: none;
  }

  .snippet-choice {
    grid-template-columns: 1fr auto;
  }

  .snippet-copy {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
