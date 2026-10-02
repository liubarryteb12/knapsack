<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NModal, NForm, NFormItem, NInput, NSelect, NPopconfirm, NDatePicker, useMessage } from 'naive-ui'
import { Sparkles, Download, Copy, Trash2, MapPin, Plus, FolderInput } from '@lucide/vue'
import { useTripsStore } from '../stores/trips'
import { exportTripFile, readTripFileInput, readTripFile, TripImportError } from '../utils/tripFile'
import { checkAiReachable } from '../utils/aiConfig'
import { fenToYuan, yuanToFen } from '../utils/money'
import { todayStr, addDays, daysBetween, fromDateStr, toDateStr } from '../utils/date'
import type { DestType, Trip } from '../schema/trip'
import AiDraftModal from '../components/AiDraftModal.vue'
import UiPageHeader from '../components/ui/UiPageHeader.vue'
import UiEmptyState from '../components/ui/UiEmptyState.vue'
import UiStatusBadge from '../components/ui/UiStatusBadge.vue'
import UiStatCard from '../components/ui/UiStatCard.vue'
import { destTypeIcon } from '../components/icons'
import { CalendarDays, Wallet, Compass } from '@lucide/vue'

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

/** 人性化日期：同年省略年份，如「10月2日 – 4日」 */
function humanDate(trip: Trip): string {
  const [sy, sm, sd] = trip.startDate.split('-')
  const [, em, ed] = trip.endDate.split('-')
  const year = new Date().getFullYear().toString()
  const start = `${Number(sm)}月${Number(sd)}日`
  const end = sm === em ? `${Number(ed)}日` : `${Number(em)}月${Number(ed)}日`
  const y = sy === year ? '' : `${sy}年`
  return `${y}${start} – ${end}`
}

// ---- 统计行 ----
const isEmpty = computed(() => tripsStore.loaded && tripsStore.trips.length === 0)
const totalCount = computed(() => tripsStore.trips.length)
const ongoingCount = computed(() => {
  const today = todayStr()
  return tripsStore.trips.filter((t) => t.startDate <= today && t.endDate >= today).length
})
const totalSpentYuan = computed(() =>
  fenToYuan(tripsStore.trips.reduce((a, t) => a + t.expenses.reduce((x, e) => x + e.amountFen, 0), 0)),
)

// ---- AI 草稿入口 ----
const showAi = ref(false)
// 不能用 navigator.onLine：安卓 WebView 在无默认网络时仍返回 true，改用真实探活
const aiOnline = ref(false)
let aiRetryTimer: ReturnType<typeof setTimeout> | null = null

async function probeAi() {
  const reachable = await checkAiReachable()
  aiOnline.value = reachable
  if (aiRetryTimer) {
    clearTimeout(aiRetryTimer)
    aiRetryTimer = null
  }
  // 探活失败就定时重试：安卓 WebView 的 online 事件不一定触发，
  // 网络恢复后得自己再探一次，否则按钮会一直停在置灰状态
  if (!reachable) {
    aiRetryTimer = setTimeout(probeAi, 10000)
  }
}

onMounted(() => {
  probeAi()
  window.addEventListener('online', probeAi)
  window.addEventListener('offline', probeAi)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', probeAi)
  window.removeEventListener('offline', probeAi)
  if (aiRetryTimer) {
    clearTimeout(aiRetryTimer)
    aiRetryTimer = null
  }
})
</script>

<template>
  <div class="page">
    <UiPageHeader title="我的旅行">
      <n-button :disabled="!aiOnline" @click="showAi = true" :title="aiOnline ? '' : '断网时 AI 功能不可用'">
        <template #icon><Sparkles :size="15" /></template>
        AI 行程草稿
      </n-button>
      <n-button @click="pickFile">
        <template #icon><FolderInput :size="15" /></template>
        导入 .trip
      </n-button>
      <n-button type="primary" @click="openCreate">
        <template #icon><Plus :size="15" /></template>
        新建旅行
      </n-button>
    </UiPageHeader>
    <input ref="fileInput" type="file" accept=".trip,.json" style="display: none" @change="onFilePicked" />

    <!-- 空状态：主行动 + 局域网会话引导（扫码入口在这里可见） -->
    <UiEmptyState
      v-if="isEmpty"
      title="还没有旅行计划"
      description="新建一个，用 AI 生成草稿，或者导入朋友分享的 .trip 文件；电脑和手机还能通过局域网会话互传行程。"
    >
      <n-button type="primary" @click="openCreate">
        <template #icon><Plus :size="15" /></template>
        新建旅行
      </n-button>
      <n-button @click="pickFile">导入 .trip</n-button>
      <n-button quaternary @click="router.push('/settings')">如何多设备同步？</n-button>
    </UiEmptyState>

    <template v-else>
      <!-- 统计行 -->
      <div class="stats-row">
        <UiStatCard :icon="Compass" label="全部旅行" :value="`${totalCount} 个`" />
        <UiStatCard :icon="CalendarDays" label="进行中" :value="`${ongoingCount} 个`" />
        <UiStatCard :icon="Wallet" label="累计花费" :value="`¥${totalSpentYuan}`" />
      </div>

      <div class="trip-grid">
        <n-card v-for="trip in tripsStore.trips" :key="trip.id" class="trip-card" hoverable>
          <div class="trip-card-head" @click="router.push(`/trip/${trip.id}`)">
            <span class="dest-icon" :data-type="trip.destType">
              <component :is="destTypeIcon[trip.destType]" :size="17" :stroke-width="2" />
            </span>
            <span class="trip-name">{{ trip.name }}</span>
            <UiStatusBadge :start-date="trip.startDate" :end-date="trip.endDate" />
          </div>
          <div class="trip-meta">
            <div class="meta-line">{{ humanDate(trip) }} · {{ daysOf(trip) }} 天<span v-if="trip.destCity" class="meta-city"><MapPin :size="12" :stroke-width="2" />{{ trip.destCity }}</span></div>
            <div v-if="trip.totalBudgetFen > 0" class="budget-line tnum">
              <span>¥{{ fenToYuan(usedFen(trip)) }}</span>
              <span class="muted">/ ¥{{ fenToYuan(trip.totalBudgetFen) }}</span>
              <span class="budget-pct" :class="{ over: budgetPct(trip) >= 100 }">{{ budgetPct(trip) }}%</span>
            </div>
            <div v-if="trip.totalBudgetFen > 0" class="budget-bar">
              <div class="budget-bar-inner" :class="{ over: budgetPct(trip) >= 100 }" :style="{ width: budgetPct(trip) + '%' }" />
            </div>
          </div>
          <template #action>
            <div class="card-actions">
              <n-button size="small" quaternary @click="router.push(`/trip/${trip.id}`)">打开</n-button>
              <n-button size="small" quaternary @click="doExport(trip)">
                <template #icon><Download :size="14" /></template>
                导出
              </n-button>
              <n-button size="small" quaternary @click="copyTrip(trip.id)">
                <template #icon><Copy :size="14" /></template>
                复制
              </n-button>
              <n-popconfirm @positive-click="removeTrip(trip.id)">
                <template #trigger>
                  <n-button size="small" quaternary type="error">
                    <template #icon><Trash2 :size="14" /></template>
                    删除
                  </n-button>
                </template>
                确定删除「{{ trip.name }}」？此操作不可恢复。
              </n-popconfirm>
            </div>
          </template>
        </n-card>
      </div>
    </template>

    <!-- 新建旅行 -->
    <n-modal v-model:show="showCreate" preset="card" title="新建旅行" style="width: min(420px, calc(100vw - 32px))">
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
    <n-modal v-model:show="showImportChoice" preset="card" title="导入旅行" style="width: min(420px, calc(100vw - 32px))">
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
.stats-row {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
  flex-wrap: wrap;
}

.trip-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.trip-card {
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}

/* hover 上浮 */
.trip-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.trip-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  min-width: 0;
}

.dest-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 目的地类型的图标配色（与令牌对应） */
.dest-icon[data-type='city'] {
  background: var(--type-transport-soft);
  color: var(--type-transport);
}

.dest-icon[data-type='beach'] {
  background: var(--type-play-soft);
  color: var(--type-play);
}

.dest-icon[data-type='mountain'] {
  background: var(--type-stay-soft);
  color: var(--type-stay);
}

.dest-icon[data-type='generic'] {
  background: var(--type-other-soft);
  color: var(--type-other);
}

.trip-name {
  font-weight: 600;
  font-size: var(--text-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.trip-card-head .ui-status-badge {
  flex-shrink: 0;
}

.trip-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-sm);
}

.meta-line {
  color: var(--app-muted);
}

.meta-city {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 8px;
}

.budget-line {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.budget-pct {
  margin-left: auto;
  color: var(--app-accent);
  font-weight: 600;
  font-size: var(--text-xs);
}

.budget-pct.over {
  color: var(--app-danger);
}

.budget-bar {
  height: 6px;
  background: var(--app-chip-bg);
  border-radius: 3px;
  overflow: hidden;
}

.budget-bar-inner {
  height: 100%;
  background: var(--app-accent-solid);
  border-radius: 3px;
  transition: width var(--dur-normal) var(--ease);
}

.budget-bar-inner.over {
  background: var(--app-danger);
}

.card-actions {
  display: flex;
  gap: var(--space-1);
  justify-content: flex-end;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 720px) {
  .page {
    padding: var(--space-4);
  }

  .trip-grid {
    grid-template-columns: 1fr;
  }
}
</style>
