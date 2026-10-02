<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NModal, NForm, NFormItem, NInput, NSelect, NDatePicker,
  NCheckboxGroup, NCheckbox, NInputNumber, NCard, NProgress, NEmpty, NDropdown, useMessage } from 'naive-ui'
import type { Trip, Expense, ExpenseCategory, Member } from '../schema/trip'
import { nanoid } from 'nanoid'
import { useTripsStore } from '../stores/trips'
import { fenToYuan, yuanToFen, formatFen } from '../utils/money'
import { settleExpenses, memberName } from '../utils/settle'
import { expenseCategoryOptions, expenseCategoryLabel } from './itemMeta'
import { readTripFileInput, TripImportError } from '../utils/tripFile'
import { expenseSchema } from '../schema/trip'
import { todayStr, fromDateStr, toDateStr } from '../utils/date'

const props = defineProps<{ trip: Trip }>()
const tripsStore = useTripsStore()
const message = useMessage()

// ---- 汇总 ----
const totalUsedFen = computed(() => props.trip.expenses.reduce((a, e) => a + e.amountFen, 0))
const remainFen = computed(() => props.trip.totalBudgetFen - totalUsedFen.value)
const usedPct = computed(() =>
  props.trip.totalBudgetFen > 0
    ? Math.min(100, Math.round((totalUsedFen.value / props.trip.totalBudgetFen) * 100))
    : 0,
)

const categoryStats = computed(() => {
  const map = new Map<ExpenseCategory, number>()
  for (const e of props.trip.expenses) {
    map.set(e.category, (map.get(e.category) ?? 0) + e.amountFen)
  }
  return [...map.entries()]
    .map(([category, fen]) => ({
      category,
      fen,
      pct: totalUsedFen.value > 0 ? Math.round((fen / totalUsedFen.value) * 100) : 0,
    }))
    .sort((a, b) => b.fen - a.fen)
})

const memberOptions = computed(() =>
  props.trip.members.map((m) => ({ label: m.name, value: m.id })),
)

// ---- 花费表单 ----
const showEdit = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  date: todayStr(),
  category: 'food' as ExpenseCategory,
  title: '',
  amountYuan: '',
  payerId: '',
  mode: 'equal' as 'equal' | 'shares' | 'custom',
  memberIds: [] as string[],
  shares: [] as number[],
  customAmounts: {} as Record<string, string>,
})

function openCreate() {
  editingId.value = null
  form.value = {
    date: todayStr(),
    category: 'food',
    title: '',
    amountYuan: '',
    payerId: props.trip.members[0]?.id ?? '',
    mode: 'equal',
    memberIds: props.trip.members.map((m) => m.id),
    shares: props.trip.members.map(() => 1),
    customAmounts: {},
  }
  showEdit.value = true
}

function openEdit(e: Expense) {
  editingId.value = e.id
  const custom: Record<string, string> = {}
  if (e.split.mode === 'custom') {
    for (const [id, fen] of Object.entries(e.split.amounts)) {
      custom[id] = fenToYuan(fen)
    }
  }
  form.value = {
    date: e.date,
    category: e.category,
    title: e.title,
    amountYuan: fenToYuan(e.amountFen),
    payerId: e.payerId,
    mode: e.split.mode,
    memberIds: e.split.mode === 'custom' ? props.trip.members.map((m) => m.id) : [...e.split.memberIds],
    shares: e.split.mode === 'shares' ? [...e.split.shares] : props.trip.members.map(() => 1),
    customAmounts: custom,
  }
  showEdit.value = true
}

async function submitExpense() {
  const title = form.value.title.trim()
  if (!title) return
  const amountFen = yuanToFen(form.value.amountYuan)
  if (amountFen === null) {
    message.error('金额格式不对，请输入例如 292.50')
    return
  }
  if (form.value.mode !== 'custom' && form.value.memberIds.length === 0) {
    message.error('请至少选择一名分摊成员')
    return
  }
  if (form.value.payerId && !props.trip.members.some((m) => m.id === form.value.payerId)) {
    message.error('付款人无效，请重新选择')
    return
  }

  let split: Expense['split']
  if (form.value.mode === 'equal') {
    split = { mode: 'equal', memberIds: [...form.value.memberIds] }
  } else if (form.value.mode === 'shares') {
    // 份数与 memberIds 一一对应：勾选变化时按索引映射，缺省 1 份
    const sharesById = new Map<string, number>()
    for (let i = 0; i < form.value.memberIds.length; i++) {
      const id = form.value.memberIds[i]
      if (id !== undefined) sharesById.set(id, Math.max(1, form.value.shares[i] ?? 1))
    }
    split = {
      mode: 'shares',
      memberIds: [...form.value.memberIds],
      shares: form.value.memberIds.map((id) => sharesById.get(id) ?? 1),
    }
  } else {
    const amounts: Record<string, number> = {}
    for (const [id, yuan] of Object.entries(form.value.customAmounts)) {
      const fen = yuanToFen(yuan ?? '0')
      if (fen !== null && fen > 0) amounts[id] = fen
    }
    if (Object.keys(amounts).length === 0) {
      message.error('自定义金额至少填一人，且金额大于 0')
      return
    }
    split = { mode: 'custom', amounts }
  }

  const expense: Expense = {
    id: editingId.value ?? nanoid(10),
    date: form.value.date,
    category: form.value.category,
    title,
    amountFen,
    payerId: form.value.payerId,
    split,
  }

  if (editingId.value === null) {
    props.trip.expenses.push(expense)
  } else {
    const idx = props.trip.expenses.findIndex((x) => x.id === expense.id)
    if (idx >= 0) props.trip.expenses.splice(idx, 1, expense)
  }
  await tripsStore.saveTrip(props.trip)
  showEdit.value = false
}

async function removeExpense(id: string) {
  const idx = props.trip.expenses.findIndex((x) => x.id === id)
  if (idx >= 0) {
    props.trip.expenses.splice(idx, 1)
    await tripsStore.saveTrip(props.trip)
  }
}

// ---- 成员管理 ----
const showMembers = ref(false)
const newMemberName = ref('')

async function addMember() {
  const name = newMemberName.value.trim()
  if (!name) return
  const member: Member = { id: nanoid(8), name, role: 'member' }
  props.trip.members.push(member)
  newMemberName.value = ''
  await tripsStore.saveTrip(props.trip)
}

async function removeMember(id: string) {
  const member = props.trip.members.find((m) => m.id === id)
  if (member?.role === 'owner') {
    message.error('不能删除发起人')
    return
  }
  // 该成员被花费引用（付款人/分摊人）时不允许删，避免结算出现幽灵成员
  const referenced = props.trip.expenses.some(
    (e) =>
      e.payerId === id ||
      (e.split.mode !== 'custom' && e.split.memberIds.includes(id)) ||
      (e.split.mode === 'custom' && (e.split.amounts[id] ?? 0) > 0),
  )
  if (referenced) {
    message.error('该成员已有花费记录，无法删除。请先删除或修改相关花费')
    return
  }
  props.trip.members = props.trip.members.filter((m) => m.id !== id)
  await tripsStore.saveTrip(props.trip)
}

// ---- 结算 ----
const settlement = computed(() => settleExpenses(props.trip))

// ---- 花费合并导入 ----
const fileInput = ref<HTMLInputElement | null>(null)

function pickMergeFile() {
  fileInput.value?.click()
}

async function onMergeFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await readTripFileInput(file)
    const data = JSON.parse(text) as { expenses?: unknown }
    if (!Array.isArray(data.expenses)) {
      message.error('文件里没有 expenses 数组，无法合并')
      return
    }
    // 每笔花费先过 Zod，坏数据跳过而不是静默写入
    const incoming: Expense[] = []
    let badCount = 0
    for (const raw of data.expenses) {
      const parsed = expenseSchema.safeParse(raw)
      if (parsed.success) incoming.push(parsed.data)
      else badCount++
    }
    const existingIds = new Set(props.trip.expenses.map((x) => x.id))
    let added = 0
    for (const e of incoming) {
      if (!existingIds.has(e.id)) {
        props.trip.expenses.push(e)
        existingIds.add(e.id)
        added++
      }
    }
    await tripsStore.saveTrip(props.trip)
    const skippedDup = data.expenses.length - badCount - added
    message.success(`合并完成：新增 ${added} 笔，跳过重复 ${skippedDup} 笔${badCount > 0 ? `，丢弃损坏 ${badCount} 笔` : ''}`)
  } catch (err) {
    if (err instanceof TripImportError) message.error(err.message)
    else message.error('合并失败：文件格式不对')
  }
}

const expenseActions = [
  { label: '编辑', key: 'edit' },
  { label: '删除', key: 'delete' },
]

async function onExpenseAction(key: string, e: Expense) {
  if (key === 'edit') openEdit(e)
  else if (key === 'delete') await removeExpense(e.id)
}
</script>

<template>
  <div class="budget">
    <!-- 总预算 -->
    <n-card size="small" class="section" title="预算">
      <div class="budget-summary">
        <div class="budget-numbers">
          <span class="big">{{ formatFen(totalUsedFen) }}</span>
          <span class="muted">/ {{ formatFen(trip.totalBudgetFen) }}</span>
          <span class="remain" :class="{ over: remainFen < 0 }">
            剩余 {{ formatFen(remainFen) }}
          </span>
        </div>
        <n-progress
          type="line"
          :percentage="usedPct"
          :show-indicator="false"
          :height="10"
          :border-radius="5"
          :color="usedPct > 100 ? '#ef4444' : '#6366f1'"
        />
      </div>
    </n-card>

    <!-- 分类占比 -->
    <n-card size="small" class="section" title="分类占比">
      <n-empty v-if="categoryStats.length === 0" description="暂无花费" size="small" />
      <div v-for="stat in categoryStats" :key="stat.category" class="cat-row">
        <span class="cat-label">{{ expenseCategoryLabel[stat.category] }}</span>
        <n-progress
          type="line"
          :percentage="stat.pct"
          :show-indicator="false"
          :height="8"
          :border-radius="4"
          color="#818cf8"
          class="cat-bar"
        />
        <span class="cat-fen">{{ formatFen(stat.fen) }}（{{ stat.pct }}%）</span>
      </div>
    </n-card>

    <!-- 成员 -->
    <n-card size="small" class="section" title="成员">
      <div class="member-row">
        <span v-for="m in trip.members" :key="m.id" class="member-chip">
          {{ m.name }}
          <button v-if="m.role !== 'owner'" class="member-x" @click="removeMember(m.id)">×</button>
        </span>
        <n-button size="tiny" @click="showMembers = true">管理</n-button>
      </div>
    </n-card>

    <!-- 花费列表 -->
    <n-card size="small" class="section" title="花费记录">
      <template #header-extra>
        <div class="section-actions">
          <n-button size="small" @click="pickMergeFile">合并导入</n-button>
          <n-button size="small" type="primary" @click="openCreate">+ 记一笔</n-button>
        </div>
      </template>
      <input ref="fileInput" type="file" accept=".trip,.json" style="display: none" @change="onMergeFile" />

      <n-empty v-if="trip.expenses.length === 0" description="还没有花费记录" size="small" />
      <div v-for="e in trip.expenses" :key="e.id" class="expense-row">
        <span class="e-date">{{ e.date.slice(5) }}</span>
        <span class="e-cat">{{ expenseCategoryLabel[e.category] }}</span>
        <span class="e-title">{{ e.title }}</span>
        <span class="e-amount">{{ formatFen(e.amountFen) }}</span>
        <span class="e-payer">{{ memberName(trip.members, e.payerId) }} 付</span>
        <n-dropdown trigger="click" :options="expenseActions" @select="(key: string) => onExpenseAction(key, e)">
          <n-button size="tiny" quaternary>⋯</n-button>
        </n-dropdown>
      </div>
    </n-card>

    <!-- 结算建议 -->
    <n-card v-if="trip.members.length > 1" size="small" class="section" title="结算建议">
      <p class="muted small">谁该给谁转多少（每次打开现算，不保存）：</p>
      <n-empty v-if="settlement.debts.length === 0" description="暂无债务，两清了" size="small" />
      <div v-for="(d, i) in settlement.debts" :key="i" class="debt-row">
        <strong>{{ memberName(trip.members, d.fromId) }}</strong>
        <span>→ 应给</span>
        <strong>{{ memberName(trip.members, d.toId) }}</strong>
        <span class="debt-amount">{{ formatFen(d.amountFen) }}</span>
      </div>
    </n-card>

    <!-- 记一笔表单 -->
    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '编辑花费' : '记一笔'" style="width: min(460px, calc(100vw - 32px))">
      <n-form label-placement="left" label-width="80">
        <n-form-item label="日期">
          <n-date-picker
            :value="fromDateStr(form.date)"
            type="date"
            @update:value="(ts: number) => (form.date = toDateStr(new Date(ts)))"
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="分类">
          <n-select v-model:value="form.category" :options="expenseCategoryOptions" />
        </n-form-item>
        <n-form-item label="标题">
          <n-input v-model:value="form.title" placeholder="例如：高铁票" />
        </n-form-item>
        <n-form-item label="金额(元)">
          <n-input v-model:value="form.amountYuan" placeholder="例如 292.50" />
        </n-form-item>
        <n-form-item label="付款人">
          <n-select v-model:value="form.payerId" :options="memberOptions" />
        </n-form-item>
        <n-form-item label="分摊方式">
          <n-select
            v-model:value="form.mode"
            :options="[
              { label: '均分', value: 'equal' },
              { label: '按份', value: 'shares' },
              { label: '自定义金额', value: 'custom' },
            ]"
          />
        </n-form-item>

        <template v-if="form.mode === 'equal'">
          <n-form-item label="参与人">
            <n-checkbox-group v-model:value="form.memberIds">
              <n-checkbox v-for="m in trip.members" :key="m.id" :value="m.id" :label="m.name" />
            </n-checkbox-group>
          </n-form-item>
        </template>

        <template v-else-if="form.mode === 'shares'">
          <n-form-item label="参与人">
            <n-checkbox-group v-model:value="form.memberIds">
              <n-checkbox v-for="m in trip.members" :key="m.id" :value="m.id" :label="m.name" />
            </n-checkbox-group>
          </n-form-item>
          <n-form-item v-for="(id, i) in form.memberIds" :key="id" :label="memberName(trip.members, id)">
            <n-input-number v-model:value="form.shares[i]" :min="1" :step="1" />
            <span class="muted">&nbsp;份</span>
          </n-form-item>
        </template>

        <template v-else>
          <n-form-item v-for="m in trip.members" :key="m.id" :label="m.name">
            <n-input v-model:value="form.customAmounts[m.id]" placeholder="0.00" />
          </n-form-item>
        </template>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" @click="submitExpense">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 成员管理 -->
    <n-modal v-model:show="showMembers" preset="card" title="成员管理" style="width: min(380px, calc(100vw - 32px))">
      <div class="member-list">
        <div v-for="m in trip.members" :key="m.id" class="member-item">
          <span>{{ m.name }}<span v-if="m.role === 'owner'" class="muted">（发起人）</span></span>
          <n-button v-if="m.role !== 'owner'" size="tiny" quaternary type="error" @click="removeMember(m.id)">移除</n-button>
        </div>
      </div>
      <div class="member-add">
        <n-input v-model:value="newMemberName" placeholder="新成员名字" @keyup.enter="addMember" />
        <n-button type="primary" @click="addMember">添加</n-button>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.budget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
}

.section-actions {
  display: flex;
  gap: 8px;
}

.budget-numbers {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.big {
  font-size: 22px;
  font-weight: 700;
}

.remain {
  margin-left: auto;
  color: #16a34a;
  font-size: 13px;
}

.remain.over {
  color: #ef4444;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.cat-label {
  width: 40px;
  font-size: 13px;
}

.cat-bar {
  flex: 1;
}

.cat-fen {
  font-size: 12px;
  color: #6b7280;
  min-width: 110px;
  text-align: right;
}

.member-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.member-chip {
  background: #eef2ff;
  color: #4338ca;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.member-x {
  border: none;
  background: none;
  cursor: pointer;
  color: #818cf8;
  font-size: 14px;
  padding: 0;
}

.expense-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
}

.e-date {
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}

.e-cat {
  background: #f3f4f6;
  border-radius: 8px;
  padding: 1px 8px;
  font-size: 12px;
  color: #6b7280;
}

.e-title {
  flex: 1;
  font-weight: 500;
}

.e-amount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.e-payer {
  color: #9ca3af;
  font-size: 12px;
}

.debt-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  font-size: 14px;
}

.debt-amount {
  margin-left: auto;
  font-weight: 700;
  color: #ef4444;
  font-variant-numeric: tabular-nums;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.member-add {
  display: flex;
  gap: 8px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.muted {
  color: #9ca3af;
}

.small {
  font-size: 12px;
}
</style>
