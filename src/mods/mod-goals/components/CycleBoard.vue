<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NProgress, NTag } from 'naive-ui'
import { Plus } from '@lucide/vue'
import TaskRow from './TaskRow.vue'
import { useGoalsStore } from '../store'
import { completionRatio, type Cycle, type Task } from '../schema'

const props = defineProps<{ goalId: string }>()

const store = useGoalsStore()

const cycles = computed(() => store.cyclesOf(props.goalId))
const unassigned = computed(() => store.unassignedTasks(props.goalId))

const label = ref('')
const startDate = ref('')
const endDate = ref('')
const focus = ref('')

function tasksOfCycle(cycleId: string): Task[] {
  return store.tasks.filter((task) => task.cycleId === cycleId)
}

function percentOf(cycleId: string): number {
  const ratio = completionRatio(tasksOfCycle(cycleId))
  return ratio === null ? 0 : Math.round(ratio * 100)
}

async function addCycle() {
  if (!label.value.trim() || !startDate.value || !endDate.value) return
  await store.createCycle(props.goalId, {
    label: label.value.trim(),
    startDate: startDate.value,
    endDate: endDate.value,
    focus: focus.value.trim(),
  })
  label.value = ''
  startDate.value = ''
  endDate.value = ''
  focus.value = ''
}

async function saveFocus(cycle: Cycle, event: Event) {
  const value = (event.target as HTMLInputElement | null)?.value ?? ''
  if (value !== cycle.focus) await store.updateCycle(cycle.id, { focus: value })
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
  <div class="cycle-board">
    <section v-for="cycle in cycles" :key="cycle.id" class="cycle-card">
      <header class="cycle-head">
        <h4>{{ cycle.label }}</h4>
        <n-tag size="tiny" :bordered="false">{{ cycle.startDate }} → {{ cycle.endDate }}</n-tag>
      </header>
      <n-input
        :default-value="cycle.focus"
        size="small"
        :bordered="false"
        placeholder="这个周期的聚焦点"
        class="cycle-focus"
        @blur="saveFocus(cycle, $event)"
      />
      <n-progress type="line" :percentage="percentOf(cycle.id)" :height="4" :show-indicator="false" />
      <div class="cycle-tasks">
        <TaskRow
          v-for="task in tasksOfCycle(cycle.id)"
          :key="task.id"
          :task="task"
          :cycles="cycles"
          @update="(patch) => onTaskUpdate(task, patch)"
          @cycle="(cycleId) => onTaskCycle(task, cycleId)"
        />
        <p v-if="tasksOfCycle(cycle.id).length === 0" class="cycle-empty">这个周期还没排任务。</p>
      </div>
    </section>

    <section class="cycle-card cycle-new">
      <h4>新增周期</h4>
      <n-input v-model:value="label" size="small" placeholder="周期名称，例如 2026-11 第 4 周" />
      <div class="cycle-dates">
        <input v-model="startDate" class="cycle-date" type="date" />
        <span>→</span>
        <input v-model="endDate" class="cycle-date" type="date" />
      </div>
      <n-input v-model:value="focus" size="small" placeholder="聚焦点（可留空）" />
      <n-button size="small" type="primary" :disabled="!label.trim() || !startDate || !endDate" @click="addCycle">
        <template #icon><Plus :size="14" /></template>
        添加周期
      </n-button>
    </section>

    <section class="cycle-card">
      <h4>未排期任务</h4>
      <div class="cycle-tasks">
        <TaskRow
          v-for="task in unassigned"
          :key="task.id"
          :task="task"
          :cycles="cycles"
          @update="(patch) => onTaskUpdate(task, patch)"
          @cycle="(cycleId) => onTaskCycle(task, cycleId)"
        />
        <p v-if="unassigned.length === 0" class="cycle-empty">所有任务都已排期。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cycle-board {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cycle-card {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-card-bg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cycle-card h4 {
  font-size: var(--text-md);
  font-weight: 600;
}

.cycle-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.cycle-focus {
  color: var(--app-muted);
}

.cycle-tasks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cycle-empty {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.cycle-new {
  border-style: dashed;
}

.cycle-dates {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.cycle-date {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  background: var(--app-bg-soft);
  color: var(--app-text);
  padding: 4px 8px;
  font-size: var(--text-sm);
}
</style>
