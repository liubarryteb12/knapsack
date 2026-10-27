<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NInput,
  NModal,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  Download,
  Pencil,
  Plus,
  ReceiptText,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
} from '@lucide/vue'
import UiPageHeader from '../../components/ui/UiPageHeader.vue'
import UiStatCard from '../../components/ui/UiStatCard.vue'
import { modRegistry } from '../../core/bootMods'
import type { SpecialExpenseLedgerEntry } from '../../core/capabilityContracts'
import { todayStr } from '../../utils/date'
import { fenToYuan, formatFen, yuanToFen } from '../../utils/money'
import {
  defaultNatureFor,
  FINANCE_CATEGORY_LABELS,
  FINANCE_NATURE_LABELS,
  travelCategoryToFinance,
  type FinanceCategory,
  type FinanceEntry,
  type FinanceNature,
} from './schema'
import {
  categoryBreakdown,
  compositionEntries,
  entriesInMonth,
  last7Days,
  natureBreakdown,
  sumFen,
} from './stats'
import { useFinanceStore, type TripExpenseSelection } from './store'

const store = useFinanceStore()
const message = useMessage()
const today = todayStr()
const month = ref(today.slice(0, 7))
const categoryFilter = ref<'all' | FinanceCategory>('all')
const includeTrip = ref(true)
const budgetDraft = ref('0.00')
const savingBudget = ref(false)

const categoryOptions = (Object.entries(FINANCE_CATEGORY_LABELS) as [FinanceCategory, string][]).map(
  ([value, label]) => ({ value, label }),
)
const filterOptions = [{ value: 'all', label: '全部类别' }, ...categoryOptions]
const natureOptions = (Object.entries(FINANCE_NATURE_LABELS) as [FinanceNature, string][]).map(
  ([value, label]) => ({ value, label }),
)

onMounted(async () => {
  await store.load()
  budgetDraft.value = fenToYuan(store.budgetFen)
})

watch(month, async (value) => {
  await store.loadMonth(value)
  budgetDraft.value = fenToYuan(store.budgetFen)
})

watch(
  () => store.budgetFen,
  (value) => {
    budgetDraft.value = fenToYuan(value)
  },
)

const monthEntries = computed(() => entriesInMonth(store.entries, month.value))
const filteredEntries = computed(() =>
  categoryFilter.value === 'all'
    ? monthEntries.value
    : monthEntries.value.filter((e) => e.category === categoryFilter.value),
)
const monthTotal = computed(() => sumFen(monthEntries.value))
const todayTotal = computed(() => sumFen(store.entries.filter((e) => e.date === today)))
const analysisRows = computed(() => compositionEntries(monthEntries.value, includeTrip.value))
const analysisTotal = computed(() => sumFen(analysisRows.value))
const breakdown = computed(() => categoryBreakdown(analysisRows.value))
const natureStats = computed(() => natureBreakdown(analysisRows.value))
const trend = computed(() => last7Days(store.entries, today))
const trendMax = computed(() => Math.max(1, ...trend.value.map((d) => d.totalFen)))
const budgetPct = computed(() =>
  store.budgetFen > 0 ? Math.round((monthTotal.value / store.budgetFen) * 100) : 0,
)
const budgetRemaining = computed(() => store.budgetFen - monthTotal.value)

async function saveBudget() {
  const amountFen = yuanToFen(budgetDraft.value)
  if (amountFen === null) {
    message.error('预算金额格式不对')
    return
  }
  savingBudget.value = true
  const ok = await store.saveBudget(month.value, amountFen)
  savingBudget.value = false
  if (!ok) {
    message.error(store.error || '预算保存失败')
    return
  }
  message.success(amountFen > 0 ? '月度预算已保存' : '已关闭本月预算预警')
}

function categoryLabel(category: FinanceCategory): string {
  return FINANCE_CATEGORY_LABELS[category]
}

function barWidth(value: number, max: number): string {
  if (value <= 0) return '0%'
  return `${Math.max(3, Math.round((value / max) * 100))}%`
}

const quick = ref({
  date: today,
  amountYuan: '',
  category: 'food' as FinanceCategory,
  natureTag: 'ESSENTIAL' as FinanceNature,
  note: '',
})

watch(
  () => quick.value.category,
  (category) => {
    quick.value.natureTag = defaultNatureFor(category, 'manual')
  },
)

async function addQuick() {
  const amountFen = yuanToFen(quick.value.amountYuan)
  if (amountFen === null || amountFen <= 0) {
    message.error('金额格式不对：请填大于 0 的两位小数以内数字')
    return
  }
  const entry = await store.add({
    date: quick.value.date,
    amountFen,
    category: quick.value.category,
    natureTag: quick.value.natureTag,
    note: quick.value.note.trim(),
  })
  if (!entry) {
    message.error(store.error || '记账失败')
    return
  }
  quick.value.amountYuan = ''
  quick.value.note = ''
  message.success('已记一笔，只保存在本机')
}

const editing = ref<FinanceEntry | null>(null)
const editForm = ref({
  date: '',
  amountYuan: '',
  category: 'food' as FinanceCategory,
  natureTag: 'ESSENTIAL' as FinanceNature,
  note: '',
})

function openEdit(entry: FinanceEntry) {
  editing.value = entry
  editForm.value = {
    date: entry.date,
    amountYuan: fenToYuan(entry.amountFen),
    category: entry.category,
    natureTag: entry.natureTag,
    note: entry.note,
  }
}

async function saveEdit() {
  const entry = editing.value
  if (!entry) return
  const amountFen = yuanToFen(editForm.value.amountYuan)
  if (amountFen === null || amountFen <= 0) {
    message.error('金额格式不对：请填大于 0 的两位小数以内数字')
    return
  }
  const ok = await store.update(entry.id, {
    date: editForm.value.date,
    amountFen,
    category: editForm.value.category,
    natureTag: editForm.value.natureTag,
    note: editForm.value.note.trim(),
  })
  if (!ok) {
    message.error(store.error || '保存失败')
    return
  }
  editing.value = null
  message.success('账目已更新')
}

async function removeEntry(entry: FinanceEntry) {
  if (!(await store.remove(entry.id))) message.error(store.error || '删除失败')
}

const showImport = ref(false)
const importRows = ref<TripExpenseSelection[]>([])
const selectedImport = ref<string[]>([])
const importing = ref(false)

function importKey(item: TripExpenseSelection): string {
  return `${item.tripId}:${item.expenseId}`
}

function alreadyImported(item: TripExpenseSelection): boolean {
  const key = `trip:${item.tripId}:${item.expenseId}`
  return store.entries.some((e) => e.sourceKey === key)
}

async function openImport() {
  const ledgers = await modRegistry.capabilities.query<SpecialExpenseLedgerEntry[]>(
    'capability:special-expense-ledger',
  )
  importRows.value = ledgers.flat()
  selectedImport.value = []
  showImport.value = true
}

async function doImport() {
  const selections = importRows.value.filter((item) =>
    selectedImport.value.includes(importKey(item)),
  )
  if (selections.length === 0) {
    message.warning('先选择要导入的旅行花费')
    return
  }
  importing.value = true
  const result = await store.importFromTrips(selections)
  importing.value = false
  if (result.error) {
    message.error(result.error)
    return
  }
  message.success(
    `导入 ${result.imported} 笔，更新 ${result.updated} 笔，跳过 ${result.skipped} 笔`,
  )
  showImport.value = false
}

function importAmount(item: TripExpenseSelection): string {
  return formatFen(item.personalNetFen)
}
</script>

<template>
  <div class="finance-page">
    <UiPageHeader title="日常账房" subtitle="只记录本机花费与消费结构，不接支付、转账或金融接口">
      <div class="month-control">
        <input v-model="month" class="month-input" type="month" aria-label="账目月份" />
        <n-button @click="openImport">
          <template #icon><Download :size="15" /></template>
          导入旅行花费
        </n-button>
      </div>
    </UiPageHeader>

    <n-alert v-if="store.error" type="warning" :bordered="false" class="error-alert">
      {{ store.error }}
    </n-alert>

    <div class="stats-row">
      <UiStatCard :icon="Wallet" label="本月支出" :value="formatFen(monthTotal)" />
      <UiStatCard :icon="ReceiptText" label="本月笔数" :value="String(monthEntries.length)" />
      <UiStatCard :icon="TrendingUp" label="今日支出" :value="formatFen(todayTotal)" />
    </div>

    <n-card size="small" class="section budget-card">
      <div class="budget-head">
        <div class="budget-title">
          <span class="budget-icon"><Target :size="16" /></span>
          <strong>月度预算水位</strong>
        </div>
        <div class="budget-form">
          <n-input v-model:value="budgetDraft" placeholder="例如 5000.00" />
          <n-button size="small" :loading="savingBudget" @click="saveBudget">保存预算</n-button>
        </div>
      </div>
      <template v-if="store.budgetFen > 0">
        <div class="budget-progress-head">
          <span>已用 {{ formatFen(monthTotal) }} / {{ formatFen(store.budgetFen) }}</span>
          <span :class="{ over: budgetRemaining < 0 }">
            {{ budgetRemaining >= 0 ? '剩余' : '超支' }} {{ formatFen(Math.abs(budgetRemaining)) }}
          </span>
        </div>
        <div class="budget-progress">
          <div
            class="budget-progress-fill"
            :class="{ over: budgetPct >= 100 }"
            :style="{ width: `${Math.min(100, budgetPct)}%` }"
          />
        </div>
        <div class="budget-foot">
          <span>{{ budgetPct }}%</span>
          <span v-if="budgetPct >= 80" class="budget-warning">
            {{ budgetPct >= 100 ? '本月预算已超支' : '本月预算接近上限' }}
          </span>
        </div>
      </template>
      <p v-else class="muted small budget-off">预算为 0 时不显示预警。</p>
    </n-card>

    <n-card size="small" class="section" title="快速记一笔">
      <div class="quick-form">
        <input v-model="quick.date" class="field-input" type="date" aria-label="记账日期" />
        <n-input v-model:value="quick.amountYuan" placeholder="金额，例如 36.50" />
        <n-select v-model:value="quick.category" :options="categoryOptions" class="category-select" />
        <n-select v-model:value="quick.natureTag" :options="natureOptions" class="nature-select" />
        <n-input v-model:value="quick.note" placeholder="备注（可选）" @keyup.enter="addQuick" />
        <n-button type="primary" :loading="store.saving" @click="addQuick">
          <template #icon><Plus :size="15" /></template>
          记一笔
        </n-button>
      </div>
    </n-card>

    <div class="two-col">
      <n-card size="small" title="消费双轴结构">
        <template #header-extra>
          <n-radio-group v-model:value="includeTrip" size="small">
            <n-radio-button :value="true">含旅行</n-radio-button>
            <n-radio-button :value="false">仅日常</n-radio-button>
          </n-radio-group>
        </template>
        <p class="structure-label">业务类目</p>
        <div v-if="breakdown.length === 0" class="empty">本月还没有账目。</div>
        <div v-for="item in breakdown" :key="item.category" class="bar-row">
          <div class="bar-label">
            <span>{{ item.label }}</span>
            <span class="muted">{{ formatFen(item.totalFen) }} · {{ item.percent.toFixed(1) }}%</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: barWidth(item.totalFen, analysisTotal || 1) }" />
          </div>
        </div>
        <template v-if="natureStats.length > 0">
          <p class="structure-label nature-label">消费成分</p>
          <div v-for="item in natureStats" :key="item.nature" class="bar-row">
            <div class="bar-label">
              <span>{{ item.label }}</span>
              <span class="muted">{{ formatFen(item.totalFen) }} · {{ item.percent.toFixed(1) }}%</span>
            </div>
            <div class="bar-track nature-track">
              <div class="bar-fill nature-fill" :style="{ width: barWidth(item.totalFen, analysisTotal || 1) }" />
            </div>
          </div>
        </template>
      </n-card>

      <n-card size="small" title="近 7 日趋势">
        <div class="trend">
          <div v-for="day in trend" :key="day.date" class="trend-col">
            <span class="trend-value">{{ day.totalFen > 0 ? fenToYuan(day.totalFen) : '' }}</span>
            <div class="trend-track">
              <div class="trend-fill" :style="{ height: barWidth(day.totalFen, trendMax) }" />
            </div>
            <span class="trend-date">{{ day.date.slice(5) }}</span>
          </div>
        </div>
      </n-card>
    </div>

    <n-card size="small" title="账目明细">
      <template #header-extra>
        <n-select
          v-model:value="categoryFilter"
          :options="filterOptions"
          size="small"
          class="filter-select"
        />
      </template>
      <div v-if="filteredEntries.length === 0" class="empty">这个筛选下没有账目。</div>
      <div v-for="entry in filteredEntries" :key="entry.id" class="entry-row">
        <div class="entry-main">
          <div class="entry-title">
            <n-tag size="tiny" :bordered="false">{{ categoryLabel(entry.category) }}</n-tag>
            <n-tag size="tiny" type="info" :bordered="false">{{ FINANCE_NATURE_LABELS[entry.natureTag] }}</n-tag>
            <strong>{{ entry.note || '未填写备注' }}</strong>
            <n-tag v-if="entry.source === 'trip'" size="tiny" type="info" :bordered="false">旅行导入</n-tag>
          </div>
          <span class="muted">{{ entry.date }}</span>
        </div>
        <strong class="amount">{{ formatFen(entry.amountFen) }}</strong>
        <n-button quaternary circle size="small" aria-label="编辑账目" @click="openEdit(entry)">
          <template #icon><Pencil :size="15" /></template>
        </n-button>
        <n-popconfirm @positive-click="removeEntry(entry)">
          <template #trigger>
            <n-button quaternary circle size="small" aria-label="删除账目">
              <template #icon><Trash2 :size="15" /></template>
            </n-button>
          </template>
          删除这笔账目？
        </n-popconfirm>
      </div>
    </n-card>

    <n-modal
      :show="!!editing"
      preset="card"
      title="编辑账目"
      style="width: min(480px, calc(100vw - 32px))"
      @update:show="(v: boolean) => { if (!v) editing = null }"
    >
      <div class="edit-form">
        <label>日期</label>
        <input v-model="editForm.date" class="field-input" type="date" />
        <label>金额（元）</label>
        <n-input v-model:value="editForm.amountYuan" placeholder="例如 36.50" />
        <label>类别</label>
        <n-select v-model:value="editForm.category" :options="categoryOptions" />
        <label>消费成分</label>
        <n-select v-model:value="editForm.natureTag" :options="natureOptions" />
        <label>备注</label>
        <n-input v-model:value="editForm.note" type="textarea" :rows="3" placeholder="备注（可选）" />
      </div>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="editing = null">取消</n-button>
          <n-button type="primary" :loading="store.saving" @click="saveEdit">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showImport"
      preset="card"
      title="导入旅行花费"
      style="width: min(680px, calc(100vw - 32px))"
    >
      <p class="muted small">
        只读取旅行模块的花费并复制一份到账房，不会修改旅行账本；同一笔花费重复导入会自动跳过。
      </p>
      <div v-if="importRows.length === 0" class="empty">还没有旅行花费可导入。</div>
      <n-checkbox-group v-else v-model:value="selectedImport">
        <div v-for="item in importRows" :key="importKey(item)" class="import-row">
          <n-checkbox :value="importKey(item)" :disabled="alreadyImported(item)" />
          <div class="import-main">
            <strong>{{ item.title }}</strong>
            <span class="muted small">
              {{ item.tripName }} · {{ item.date }} · {{ categoryLabel(travelCategoryToFinance(item.category)) }}
            </span>
          </div>
          <span class="amount">{{ importAmount(item) }}</span>
          <n-tag v-if="alreadyImported(item)" size="tiny" :bordered="false">已导入</n-tag>
        </div>
      </n-checkbox-group>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="showImport = false">取消</n-button>
          <n-button type="primary" :loading="importing" @click="doImport">导入所选</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.finance-page {
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--space-6);
}

.month-control {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.month-input,
.field-input {
  min-height: 34px;
  padding: 4px 9px;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-card-bg);
  color: var(--app-text);
  font: inherit;
}

.stats-row {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.error-alert {
  margin-bottom: var(--space-3);
}

.budget-card {
  padding-bottom: var(--space-3);
}

.budget-head,
.budget-progress-head,
.budget-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.budget-title,
.budget-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.budget-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.budget-form :deep(.n-input) {
  width: 150px;
}

.budget-progress-head,
.budget-foot {
  margin-top: var(--space-3);
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.budget-progress {
  height: 9px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--app-accent-tint);
}

.budget-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--app-accent-solid);
  transition: width var(--dur-normal) var(--ease);
}

.budget-progress-fill.over {
  background: var(--app-danger);
}

.over,
.budget-warning {
  color: var(--app-danger);
}

.budget-off {
  margin: var(--space-2) 0 0;
}

.section {
  margin-bottom: var(--space-4);
}

.quick-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.quick-form :deep(.n-input) {
  flex: 1 1 180px;
  min-width: 0;
}

.quick-form .field-input {
  flex: 0 1 145px;
}

.quick-form .category-select {
  flex: 0 1 120px;
  min-width: 120px;
}

.quick-form .nature-select {
  flex: 0 1 130px;
  min-width: 130px;
}

.quick-form .n-button {
  flex: 0 0 auto;
}

.two-col {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.bar-row {
  margin-bottom: var(--space-3);
}

.bar-label {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-sm);
}

.bar-track {
  height: 8px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--app-accent-tint);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--app-accent-solid);
}

.structure-label {
  margin: 0 0 var(--space-2);
  color: var(--app-muted);
  font-size: var(--text-xs);
  font-weight: 600;
}

.nature-label {
  margin-top: var(--space-5);
}

.nature-track {
  background: var(--type-play-soft);
}

.nature-fill {
  background: var(--type-play);
}

.trend {
  height: 180px;
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding-top: var(--space-5);
}

.trend-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.trend-value {
  height: 18px;
  color: var(--app-muted);
  font-size: 10px;
}

.trend-track {
  width: 100%;
  height: 100px;
  display: flex;
  align-items: flex-end;
  border-radius: var(--radius-sm);
  background: var(--app-accent-tint);
  overflow: hidden;
}

.trend-fill {
  width: 100%;
  min-height: 0;
  background: var(--app-accent-solid);
}

.trend-date {
  color: var(--app-muted);
  font-size: 10px;
  white-space: nowrap;
}

.filter-select {
  width: 130px;
}

.entry-row,
.import-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--app-border);
}

.entry-main,
.import-main {
  flex: 1;
  min-width: 0;
}

.entry-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.entry-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.edit-form > label {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.empty {
  padding: var(--space-6) var(--space-2);
  color: var(--app-muted-soft);
  font-size: var(--text-sm);
}

.muted {
  color: var(--app-muted);
}

.small {
  font-size: var(--text-xs);
}

@media (max-width: 760px) {
  .finance-page {
    padding: var(--space-4);
  }

  .month-control {
    justify-content: space-between;
  }

  .budget-form {
    width: 100%;
  }

  .budget-form :deep(.n-input) {
    flex: 1;
    width: auto;
  }

  .quick-form {
    display: flex;
  }

  .quick-form :deep(.n-input),
  .quick-form .category-select,
  .quick-form .nature-select,
  .quick-form .field-input,
  .quick-form .n-button {
    flex: 1 1 100%;
  }

  .two-col {
    grid-template-columns: 1fr;
  }

  .entry-row {
    flex-wrap: wrap;
  }

  .entry-main {
    flex-basis: 100%;
  }
}
</style>
