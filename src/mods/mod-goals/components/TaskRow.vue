<script setup lang="ts">
import { ref, watch } from 'vue'
import { NInput, NSelect, NTag } from 'naive-ui'
import type { Cycle, Task, TaskStatus } from '../schema'

const props = defineProps<{
  task: Task
  cycles: Cycle[]
}>()

const emit = defineEmits<{
  update: [patch: Partial<Omit<Task, 'id' | 'milestoneId'>>]
  cycle: [cycleId: string | null]
}>()

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  dropped: '已放弃',
}

const statusOptions = (Object.keys(STATUS_LABEL) as TaskStatus[]).map((value) => ({
  label: STATUS_LABEL[value],
  value,
}))

const cycleOptions = [
  { label: '未排期', value: '' },
  ...props.cycles.map((cycle) => ({ label: cycle.label, value: cycle.id })),
]

const title = ref(props.task.title)
watch(
  () => props.task.title,
  (value) => {
    title.value = value
  },
)

function commitTitle() {
  const value = title.value.trim()
  if (value && value !== props.task.title) emit('update', { title: value })
  if (!value) title.value = props.task.title
}

const done = () => props.task.status === 'done'
</script>

<template>
  <div class="task-row" :class="{ 'task-row-done': done() }">
    <n-select
      :value="task.status"
      :options="statusOptions"
      size="tiny"
      style="width: 92px"
      @update:value="(value: TaskStatus) => emit('update', { status: value })"
    />
    <n-input
      v-model:value="title"
      size="small"
      :bordered="false"
      class="task-title"
      @blur="commitTitle"
      @keyup.enter="commitTitle"
    />
    <n-tag size="tiny" :bordered="false">{{ task.estimate }}</n-tag>
    <n-select
      :value="task.cycleId ?? ''"
      :options="cycleOptions"
      size="tiny"
      style="width: 128px"
      @update:value="(value: string) => emit('cycle', value || null)"
    />
  </div>
</template>

<style scoped>
.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}

.task-title {
  flex: 1;
  min-width: 0;
}

.task-row-done :deep(.task-title input) {
  text-decoration: line-through;
  color: var(--app-muted);
}

@media (max-width: 720px) {
  .task-row {
    flex-wrap: wrap;
  }

  .task-title {
    flex-basis: 100%;
    order: -1;
  }
}
</style>
