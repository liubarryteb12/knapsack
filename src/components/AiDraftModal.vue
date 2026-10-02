<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton, NModal, NInput, NDatePicker, useMessage,
  NAlert, NSpin, NTag,
} from 'naive-ui'
import { useTripsStore } from '../stores/trips'
import { loadAiConfig, checkAiReachable } from '../utils/aiConfig'
import { generateDraft, AiError, draftToTrip, type AiDraft } from '../utils/aiDraft'
import { typeIcon } from './itemMeta'
import type { TripDay } from '../schema/trip'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()
const router = useRouter()
const tripsStore = useTripsStore()
const message = useMessage()

const wish = ref('')
const range = ref<[number, number] | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const draft = ref<AiDraft | null>(null)
const draftRange = ref<[number, number] | null>(null)

const canGenerate = computed(() => wish.value.trim().length > 0 && range.value !== null && !loading.value)

/** 断网时按钮置灰：navigator.onLine 在安卓 WebView 不可靠，再补一次真实探活 */
async function checkOnline(): Promise<boolean> {
  if (!navigator.onLine) {
    message.error('当前离线，AI 生成不可用')
    return false
  }
  if (!(await checkAiReachable())) {
    message.error('网络不通或 AI 接口不可达，请检查网络与接口设置')
    return false
  }
  return true
}

async function generate() {
  if (!(await checkOnline())) return
  if (!range.value) return
  loading.value = true
  errorMsg.value = ''
  draft.value = null
  const config = loadAiConfig()
  const start = toDateStr(new Date(range.value[0]))
  const end = toDateStr(new Date(range.value[1]))
  try {
    const result = await generateDraft(config, wish.value.trim(), start, end)
    // 按范围补齐缺的天
    draft.value = result.draft
    draftRange.value = [range.value[0], range.value[1]]
  } catch (err) {
    if (err instanceof AiError) errorMsg.value = err.message
    else errorMsg.value = `生成失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
  }
}

function daysOfDraft(): TripDay[] {
  if (!draft.value || !draftRange.value) return []
  const start = new Date(toDateStr(new Date(draftRange.value[0])) + 'T00:00:00')
  const end = new Date(toDateStr(new Date(draftRange.value[1])) + 'T00:00:00')
  const byDate = new Map(draft.value.days.map((d) => [d.date, d.items]))
  const out: TripDay[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = toDateStr(d)
    out.push({
      date,
      items: (byDate.get(date) ?? []).map((item) => ({
        ...item,
        linkedExpenseId: null,
        done: false,
      })),
    })
  }
  return out
}

async function confirmImport() {
  if (!draft.value || !draftRange.value) return
  const start = toDateStr(new Date(draftRange.value[0]))
  const end = toDateStr(new Date(draftRange.value[1]))
  const days = daysOfDraft()
  const trip = draftToTrip({ ...draft.value, days }, start, end)
  const saved = await tripsStore.importTrip(trip, 'asNew')
  emit('update:show', false)
  message.success('草稿已保存为新旅行')
  router.push(`/trip/${saved.id}`)
}

function close() {
  emit('update:show', false)
  errorMsg.value = ''
  draft.value = null
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <n-modal :show="props.show" preset="card" title="AI 行程草稿" style="width: min(560px, calc(100vw - 32px))" @update:show="close">
    <n-alert type="info" :show-icon="false" class="tip">
      生成结果只是草稿：确认前可预览，确认后只会保存为新旅行，绝不覆盖现有数据。
    </n-alert>

    <div class="form-row">
      <n-input
        v-model:value="wish"
        type="textarea"
        :rows="2"
        placeholder="描述你的想法，例如：两天杭州，想逛西湖和灵隐寺，节奏慢一点"
      />
    </div>
    <div class="form-row date-row">
      <n-date-picker
        v-model:value="range"
        type="daterange"
        clearable
        style="flex: 1"
      />
      <n-button type="primary" :loading="loading" :disabled="!canGenerate" @click="generate">
        生成草稿
      </n-button>
    </div>

    <n-alert v-if="errorMsg" type="error" class="result" closable>
      {{ errorMsg }}
    </n-alert>

    <div v-if="loading" class="result loading">
      <n-spin size="small" />
      <span class="muted">AI 正在规划…（最长约 1 分钟）</span>
    </div>

    <!-- 预览确认 -->
    <div v-if="draft" class="result preview">
      <div class="preview-head">
        <strong>{{ draft.name }}</strong>
        <n-tag v-if="draft.destCity" size="small">{{ draft.destCity }}</n-tag>
      </div>
      <div v-for="day in daysOfDraft()" :key="day.date" class="preview-day">
        <div class="preview-date">{{ day.date }}</div>
        <div v-for="item in day.items" :key="item.title + item.time" class="preview-item">
          <span>{{ typeIcon[item.type] }}</span>
          <span class="preview-time">{{ item.time ?? '--:--' }}</span>
          <span class="preview-title">{{ item.title }}</span>
          <span v-if="item.note" class="preview-note">{{ item.note }}</span>
        </div>
        <p v-if="day.items.length === 0" class="muted small">当天无安排</p>
      </div>
      <div class="confirm-row">
        <n-button @click="draft = null">放弃</n-button>
        <n-button type="primary" @click="confirmImport">确认，保存为新旅行</n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.tip {
  margin-bottom: 12px;
}

.form-row {
  margin-bottom: 10px;
}

.date-row {
  display: flex;
  gap: 10px;
}

.result {
  margin-top: 14px;
}

.loading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: 12px;
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.preview-day {
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
}

.preview-date {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
}

.preview-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
  padding: 2px 0;
  align-items: baseline;
}

.preview-time {
  color: var(--app-muted);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  min-width: 40px;
}

.preview-title {
  font-weight: 500;
}

.preview-note {
  color: var(--app-muted-soft);
  font-size: 12px;
}

.confirm-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
</style>
