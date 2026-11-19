<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NProgress, NSelect, NTag, useMessage } from 'naive-ui'
import { ArrowLeft, Target } from '@lucide/vue'
import UiEmptyState from '../../components/ui/UiEmptyState.vue'
import CycleBoard from './components/CycleBoard.vue'
import MilestoneList from './components/MilestoneList.vue'
import { useGoalsStore } from './store'
import type { Goal, GoalStatus } from './schema'

const route = useRoute()
const router = useRouter()
const store = useGoalsStore()
const message = useMessage()

const goalId = computed(() => String(route.params.id ?? ''))
const goal = computed<Goal | undefined>(() => store.goalById(goalId.value))
const progress = computed(() => (goal.value ? store.goalProgress(goal.value.id) : null))
const percent = computed(() => (progress.value === null ? 0 : Math.round(progress.value * 100)))
const taskCount = computed(() => {
  if (!goal.value) return 0
  return store
    .milestonesOf(goal.value.id)
    .reduce((sum, milestone) => sum + store.tasksOf(milestone.id).length, 0)
})

const STATUS_LABEL: Record<GoalStatus, string> = {
  draft: '草稿',
  active: '进行中',
  paused: '暂停',
  done: '已完成',
  abandoned: '已放弃',
}

const statusOptions = (Object.keys(STATUS_LABEL) as GoalStatus[]).map((value) => ({
  label: STATUS_LABEL[value],
  value,
}))

const priorityOptions = [
  { label: 'P1 最高', value: 1 },
  { label: 'P2 常规', value: 2 },
  { label: 'P3 有空再说', value: 3 },
]

onMounted(async () => {
  try {
    if (!store.loaded) await store.loadAll()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
})

function textOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? ''
}

async function commit(patch: Partial<Omit<Goal, 'id' | 'createdAt'>>) {
  if (!goal.value) return
  try {
    await store.updateGoal(goal.value.id, patch)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function commitText(field: 'title' | 'why' | 'successCriteria', event: Event) {
  const value = textOf(event).trim()
  const current = goal.value
  if (!current) return
  if (field === 'title' && !value) return
  if (current[field] === value) return
  void commit({ [field]: value })
}

function commitDate(field: 'startDate' | 'targetDate', event: Event) {
  const value = textOf(event)
  const current = goal.value
  if (!current) return
  if (field === 'startDate' && !value) return
  void commit(field === 'startDate' ? { startDate: value } : { targetDate: value || undefined })
}

function back() {
  void router.push('/goals')
}
</script>

<template>
  <section>
    <UiEmptyState
      v-if="!goal"
      :icon="Target"
      title="目标不存在"
      description="它可能已被删除，或者链接有误。"
    >
      <n-button @click="back">返回目标树</n-button>
    </UiEmptyState>

    <template v-else>
      <div class="detail-head">
        <n-button quaternary size="small" @click="back">
          <template #icon><ArrowLeft :size="16" /></template>
          返回
        </n-button>
        <div class="detail-title-row">
          <n-input
            :default-value="goal.title"
            size="large"
            :bordered="false"
            class="detail-title"
            @blur="(event) => commitText('title', event)"
          />
          <n-select
            :value="goal.status"
            :options="statusOptions"
            size="small"
            style="width: 110px"
            @update:value="(value: GoalStatus) => commit({ status: value })"
          />
          <n-select
            :value="goal.priority"
            :options="priorityOptions"
            size="small"
            style="width: 130px"
            @update:value="(value: 1 | 2 | 3) => commit({ priority: value })"
          />
        </div>
      </div>

      <div class="detail-progress">
        <n-progress
          type="line"
          :percentage="percent"
          :height="8"
          :show-indicator="false"
          :status="percent === 100 ? 'success' : 'default'"
        />
        <n-tag size="small" :bordered="false">
          {{ progress === null ? '未拆解' : `${taskCount} 个任务 · ${percent}%` }}
        </n-tag>
      </div>

      <div class="detail-fields">
        <label class="detail-field">
          <span>为什么做</span>
          <n-input
            :default-value="goal.why"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="一句话说清动机"
            @blur="(event) => commitText('why', event)"
          />
        </label>
        <label class="detail-field">
          <span>成功标准</span>
          <n-input
            :default-value="goal.successCriteria"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="怎样算完成，尽量可验证"
            @blur="(event) => commitText('successCriteria', event)"
          />
        </label>
        <div class="detail-dates">
          <label>
            <span>开始</span>
            <input
              class="date-input"
              type="date"
              :value="goal.startDate"
              @change="(event) => commitDate('startDate', event)"
            />
          </label>
          <label>
            <span>截止</span>
            <input
              class="date-input"
              type="date"
              :value="goal.targetDate ?? ''"
              @change="(event) => commitDate('targetDate', event)"
            />
          </label>
        </div>
      </div>

      <h2 class="section-title">里程碑与任务</h2>
      <MilestoneList :goal-id="goal.id" />

      <h2 class="section-title">周期安排</h2>
      <CycleBoard :goal-id="goal.id" />
    </template>
  </section>
</template>

<style scoped>
.detail-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.detail-title {
  flex: 1;
  min-width: 220px;
  font-size: var(--text-2xl);
  font-weight: 700;
}

.detail-progress {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.detail-progress :deep(.n-progress) {
  flex: 1;
}

.detail-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.detail-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--app-muted);
}

.detail-dates {
  grid-column: 1 / -1;
  display: flex;
  gap: var(--space-4);
}

.detail-dates label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--app-muted);
}

.date-input {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  background: var(--app-bg-soft);
  color: var(--app-text);
  padding: 4px 8px;
  font-size: var(--text-sm);
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: var(--space-5) 0 var(--space-3);
}

@media (max-width: 720px) {
  .detail-fields {
    grid-template-columns: 1fr;
  }
}
</style>
