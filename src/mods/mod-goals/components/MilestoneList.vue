<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { NButton, NInput, NProgress, NSelect, NTag } from 'naive-ui'
import { Plus } from '@lucide/vue'
import TaskRow from './TaskRow.vue'
import { useGoalsStore } from '../store'
import { completionRatio, type Milestone, type MilestoneStatus, type Task } from '../schema'

const props = defineProps<{ goalId: string }>()

const store = useGoalsStore()

const milestones = computed(() => store.milestonesOf(props.goalId))
const cycles = computed(() => store.cyclesOf(props.goalId))

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  todo: '待开始',
  active: '进行中',
  done: '已完成',
  missed: '已错过',
}

const statusOptions = (Object.keys(STATUS_LABEL) as MilestoneStatus[]).map((value) => ({
  label: STATUS_LABEL[value],
  value,
}))

const newTitle = ref('')
const newAcceptance = ref('')
const newTarget = ref('')
const taskDrafts = reactive<Record<string, string>>({})

function tasksOf(milestoneId: string): Task[] {
  return store.tasksOf(milestoneId)
}

function progressOf(milestoneId: string): number | null {
  return completionRatio(tasksOf(milestoneId))
}

function percentOf(milestoneId: string): number {
  const ratio = progressOf(milestoneId)
  return ratio === null ? 0 : Math.round(ratio * 100)
}

async function addMilestone() {
  const title = newTitle.value.trim()
  const acceptance = newAcceptance.value.trim()
  if (!title || !acceptance) return
  await store.addMilestone(props.goalId, {
    title,
    acceptance,
    targetDate: newTarget.value || undefined,
  })
  newTitle.value = ''
  newAcceptance.value = ''
  newTarget.value = ''
}

function rename(milestone: Milestone, event: Event) {
  const value = (event.target as HTMLInputElement | null)?.value?.trim() ?? ''
  if (value && value !== milestone.title) void store.updateMilestone(milestone.id, { title: value })
}

function reaccept(milestone: Milestone, event: Event) {
  const value = (event.target as HTMLInputElement | null)?.value?.trim() ?? ''
  if (value && value !== milestone.acceptance) {
    void store.updateMilestone(milestone.id, { acceptance: value })
  }
}

function retarget(milestone: Milestone, event: Event) {
  const value = (event.target as HTMLInputElement | null)?.value ?? ''
  void store.updateMilestone(milestone.id, { targetDate: value || undefined })
}

async function addTask(milestoneId: string) {
  const title = (taskDrafts[milestoneId] ?? '').trim()
  if (!title) return
  await store.addTask(milestoneId, { title })
  taskDrafts[milestoneId] = ''
}

async function onTaskUpdate(task: Task, patch: Partial<Omit<Task, 'id' | 'milestoneId'>>) {
  await store.updateTask(task.id, patch)
}

async function onTaskCycle(task: Task, cycleId: string | null) {
  if (cycleId) await store.assignTaskToCycle(task.id, cycleId)
  else await store.removeTaskFromCycle(task.id)
}
</script>

<template>
  <div class="milestone-list">
    <div v-if="milestones.length === 0" class="milestone-empty">
      还没有里程碑。先加一个能验证的阶段目标。
    </div>

    <section v-for="milestone in milestones" :key="milestone.id" class="milestone-card">
      <header class="milestone-head">
        <n-input
          :default-value="milestone.title"
          size="small"
          :bordered="false"
          class="milestone-title"
          @blur="rename(milestone, $event)"
        />
        <n-select
          :value="milestone.status"
          :options="statusOptions"
          size="tiny"
          style="width: 96px"
          @update:value="(value: MilestoneStatus) => store.updateMilestone(milestone.id, { status: value })"
        />
      </header>

      <div class="milestone-meta">
        <n-input
          :default-value="milestone.acceptance"
          size="tiny"
          :bordered="false"
          placeholder="验收口径"
          class="milestone-acceptance"
          @blur="reaccept(milestone, $event)"
        />
        <input
          class="milestone-date"
          type="date"
          :value="milestone.targetDate ?? ''"
          @change="retarget(milestone, $event)"
        />
      </div>

      <div class="milestone-progress">
        <n-progress
          type="line"
          :percentage="percentOf(milestone.id)"
          :height="4"
          :show-indicator="false"
          :status="percentOf(milestone.id) === 100 ? 'success' : 'default'"
        />
        <n-tag size="tiny" :bordered="false">
          {{ progressOf(milestone.id) === null ? '未拆解' : `${tasksOf(milestone.id).filter((t) => t.status === 'done').length}/${tasksOf(milestone.id).length}` }}
        </n-tag>
      </div>

      <div class="milestone-tasks">
        <TaskRow
          v-for="task in tasksOf(milestone.id)"
          :key="task.id"
          :task="task"
          :cycles="cycles"
          @update="(patch) => onTaskUpdate(task, patch)"
          @cycle="(cycleId) => onTaskCycle(task, cycleId)"
        />
        <div class="milestone-add-task">
          <n-input
            v-model:value="taskDrafts[milestone.id]"
            size="small"
            placeholder="加一个可执行的任务，动词开头"
            @keyup.enter="addTask(milestone.id)"
          />
          <n-button size="small" @click="addTask(milestone.id)">
            <template #icon><Plus :size="14" /></template>
            添加
          </n-button>
        </div>
      </div>
    </section>

    <section class="milestone-new">
      <h4>新增里程碑</h4>
      <n-input v-model:value="newTitle" size="small" placeholder="里程碑标题" />
      <n-input v-model:value="newAcceptance" size="small" placeholder="验收口径（必填，可验证）" />
      <input v-model="newTarget" class="milestone-date" type="date" />
      <n-button size="small" type="primary" :disabled="!newTitle.trim() || !newAcceptance.trim()" @click="addMilestone">
        添加里程碑
      </n-button>
    </section>
  </div>
</template>

<style scoped>
.milestone-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.milestone-empty {
  color: var(--app-muted);
  font-size: var(--text-sm);
  padding: var(--space-4) 0;
}

.milestone-card {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  background: var(--app-card-bg);
}

.milestone-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.milestone-title {
  flex: 1;
  font-weight: 600;
}

.milestone-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
  flex-wrap: wrap;
}

.milestone-acceptance {
  flex: 1;
  min-width: 180px;
  color: var(--app-muted);
}

.milestone-date {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  background: var(--app-bg-soft);
  color: var(--app-text);
  padding: 2px 6px;
  font-size: var(--text-xs);
}

.milestone-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) 0;
}

.milestone-progress :deep(.n-progress) {
  flex: 1;
}

.milestone-tasks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.milestone-add-task {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.milestone-new {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}

.milestone-new h4 {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--app-muted);
}
</style>
