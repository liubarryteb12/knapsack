<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NEmpty, NModal, NForm, NFormItem, NInput, NSelect, NPopconfirm, NDatePicker, useMessage } from 'naive-ui'
import { useTripsStore } from '../stores/trips'
import { exportTripFile, readTripFileInput, readTripFile, TripImportError } from '../utils/tripFile'
import { fenToYuan, yuanToFen } from '../utils/money'
import { todayStr, addDays, daysBetween, fromDateStr, toDateStr } from '../utils/date'
import type { DestType, Trip } from '../schema/trip'
import AiDraftModal from '../components/AiDraftModal.vue'

const router = useRouter()
const tripsStore = useTripsStore()
const message = useMessage()

onMounted(() => {
  tripsStore.load()
})

const destTypeOptions = [
  { label: '城市', value: 'city' },
  { label: '海边', value: 'beach' },
  { label: '山野', value: 'mountain' },
  { label: '通用', value: 'generic' },
]

const destTypeLabel: Record<DestType, string> = {
  city: '城市',
  beach: '海边',
  mountain: '山野',
  generic: '通用',
}

// ---- 新建旅行 ----
const showCreate = ref(false)
const createForm = ref({
  name: '',
  startDate: todayStr(),
  endDate: addDays(todayStr(), 2),
  destType: 'city' as DestType,
  destCity: '',
  budgetYuan: '0',
})

function openCreate() {
  createForm.value = {
    name: '',
    startDate: todayStr(),
    endDate: addDays(todayStr(), 2),
    destType: 'city',
    destCity: '',
    budgetYuan: '0',
  }
  showCreate.value = true
}

async function submitCreate() {
  const name = createForm.value.name.trim()
  if (!name) {
    message.error('请填写旅行名称')
    return
  }
  if (createForm.value.endDate < createForm.value.startDate) {
    message.error('结束日期不能早于开始日期')
    return
  }
  const budgetFen = yuanToFen(createForm.value.budgetYuan) ?? 0
  const trip = await tripsStore.addTrip({
    name,
    startDate: createForm.value.startDate,
    endDate: createForm.value.endDate,
    destType: createForm.value.destType,
    destCity: createForm.value.destCity.trim(),
    totalBudgetFen: budgetFen,
  })
  showCreate.value = false
  message.success(`已创建「${trip.name}」`)
}

// ---- 导入 ----
const showImportChoice = ref(false)
const pendingImport = ref<Trip | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function pickFile() {
  fileInput.value?.click()
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await readTripFileInput(file)
    pendingImport.value = readTripFile(text)
    showImportChoice.value = true
  } catch (err) {
    if (err instanceof TripImportError) message.error(err.message)
    else message.error('导入失败，文件无法读取')
  }
}

async function importAsOverwrite() {
  if (!pendingImport.value) return
  const exists = tripsStore.trips.some((t) => t.id === pendingImport.value!.id)
  if (!exists) {
    message.warning('本地没有同 ID 旅行，将作为新旅行保存')
  }
  await tripsStore.importTrip(pendingImport.value, 'overwrite')
  showImportChoice.value = false
  message.success('已覆盖导入')
}

async function importAsNew() {
  if (!pendingImport.value) return
  await tripsStore.importTrip(pendingImport.value, 'asNew')
  showImportChoice.value = false
  message.success('已另存为新旅行')
}

// ---- 删除/复制/导出 ----
async function removeTrip(id: string) {
  await tripsStore.deleteTrip(id)
  message.success('已删除')
}

async function copyTrip(id: string) {
  const copy = await tripsStore.duplicateTrip(id)
  if (copy) message.success(`已复制为「${copy.name}」`)
}

function doExport(trip: Trip) {
  exportTripFile(trip)
}

// ---- 展示辅助 ----
function daysOf(trip: Trip): number {
  return daysBetween(trip.startDate, trip.endDate)
}

function budgetPct(trip: Trip): number {
  if (trip.totalBudgetFen <= 0) return 0
  const used = trip.expenses.reduce((a, e) => a + e.amountFen, 0)
  return Math.min(100, Math.round((used / trip.totalBudgetFen) * 100))
}

function usedFen(trip: Trip): number {
  return trip.expenses.reduce((a, e) => a + e.amountFen, 0)
}

const isEmpty = computed(() => tripsStore.loaded && tripsStore.trips.length === 0)

// ---- AI 草稿入口 ----
const showAi = ref(false)
const aiOnline = ref(navigator.onLine)

function updateOnline() {
  aiOnline.value = navigator.onLine
}

onMounted(() => {
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>我的旅行</h1>
      <div class="header-actions">
        <n-button :disabled="!aiOnline" @click="showAi = true" :title="aiOnline ? '' : '断网时 AI 功能不可用'">
          ✨ AI 行程草稿
        </n-button>
        <n-button @click="pickFile">导入 .trip</n-button>
        <n-button type="primary" @click="openCreate">+ 新建旅行</n-button>
      </div>
      <input ref="fileInput" type="file" accept=".trip,.json" style="display: none" @change="onFilePicked" />
    </div>

    <n-empty v-if="isEmpty" description="还没有旅行计划，点右上角新建一个吧" class="empty">
      <template #extra>
        <n-button type="primary" @click="openCreate">新建旅行</n-button>
      </template>
    </n-empty>

    <div class="trip-grid">
      <n-card v-for="trip in tripsStore.trips" :key="trip.id" class="trip-card" hoverable>
        <template #header>
          <span class="trip-name" @click="router.push(`/trip/${trip.id}`)">{{ trip.name }}</span>
        </template>
        <template #header-extra>
          <span class="dest-type">{{ destTypeLabel[trip.destType] }}</span>
        </template>
        <div class="trip-meta">
          <div>{{ trip.startDate }} ~ {{ trip.endDate }}（{{ daysOf(trip) }} 天）</div>
          <div v-if="trip.destCity" class="muted">📍 {{ trip.destCity }}</div>
          <div v-if="trip.totalBudgetFen > 0" class="budget-line">
            <span>预算 ¥{{ fenToYuan(trip.totalBudgetFen) }}</span>
            <span class="muted">已用 ¥{{ fenToYuan(usedFen(trip)) }}</span>
          </div>
          <div v-if="trip.totalBudgetFen > 0" class="budget-bar">
            <div class="budget-bar-inner" :style="{ width: budgetPct(trip) + '%' }" />
          </div>
        </div>
        <template #action>
          <div class="card-actions">
            <n-button size="small" quaternary @click="router.push(`/trip/${trip.id}`)">打开</n-button>
            <n-button size="small" quaternary @click="doExport(trip)">导出</n-button>
            <n-button size="small" quaternary @click="copyTrip(trip.id)">复制</n-button>
            <n-popconfirm @positive-click="removeTrip(trip.id)">
              <template #trigger>
                <n-button size="small" quaternary type="error">删除</n-button>
              </template>
              确定删除「{{ trip.name }}」？此操作不可恢复。
            </n-popconfirm>
          </div>
        </template>
      </n-card>
    </div>

    <!-- 新建旅行 -->
    <n-modal v-model:show="showCreate" preset="card" title="新建旅行" style="width: 420px">
      <n-form label-placement="left" label-width="80">
        <n-form-item label="名称">
          <n-input v-model:value="createForm.name" placeholder="例如：五一杭州行" />
        </n-form-item>
        <n-form-item label="开始日期">
          <n-date-picker
            :value="fromDateStr(createForm.startDate)"
            type="date"
            style="width: 100%"
            @update:value="(ts: number) => (createForm.startDate = toDateStr(new Date(ts)))"
          />
        </n-form-item>
        <n-form-item label="结束日期">
          <n-date-picker
            :value="fromDateStr(createForm.endDate)"
            type="date"
            style="width: 100%"
            @update:value="(ts: number) => (createForm.endDate = toDateStr(new Date(ts)))"
          />
        </n-form-item>
        <n-form-item label="类型">
          <n-select v-model:value="createForm.destType" :options="destTypeOptions" />
        </n-form-item>
        <n-form-item label="城市">
          <n-input v-model:value="createForm.destCity" placeholder="例如：杭州" />
        </n-form-item>
        <n-form-item label="总预算(元)">
          <n-input v-model:value="createForm.budgetYuan" placeholder="例如 5000.00" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" @click="submitCreate">创建</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 导入选择：覆盖 or 另存 -->
    <n-modal v-model:show="showImportChoice" preset="card" title="导入旅行" style="width: 420px">
      <p>
        识别到旅行：<strong>{{ pendingImport?.name }}</strong>
        （{{ pendingImport?.startDate }} ~ {{ pendingImport?.endDate }}）
      </p>
      <p class="muted">选择导入方式：覆盖同 ID 的现有旅行，或另存为新旅行。</p>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="showImportChoice = false">取消</n-button>
          <n-button @click="importAsNew">另存为新旅行</n-button>
          <n-button type="warning" @click="importAsOverwrite">覆盖现有</n-button>
        </div>
      </template>
    </n-modal>
    <!-- AI 行程草稿 -->
    <AiDraftModal v-model:show="showAi" />
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.empty {
  margin-top: 120px;
}

.trip-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.trip-name {
  cursor: pointer;
}

.trip-name:hover {
  color: #4338ca;
}

.dest-type {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 10px;
}

.trip-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.muted {
  color: #9ca3af;
}

.budget-line {
  display: flex;
  justify-content: space-between;
}

.budget-bar {
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.budget-bar-inner {
  height: 100%;
  background: #6366f1;
  border-radius: 3px;
}

.card-actions {
  display: flex;
  gap: 4px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
