<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NPopconfirm, NSelect, NTag } from 'naive-ui'
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  IndentDecrease,
  IndentIncrease,
  Pencil,
  Plus,
  Trash2,
} from '@lucide/vue'
import type { Task, TaskStatus } from '../schema'

const props = defineProps<{
  task: Task
  /** 层级深度，0 = 里程碑下的一级任务 */
  depth?: number
  actions?: boolean
  first?: boolean
  last?: boolean
  hasChildren?: boolean
}>()

const emit = defineEmits<{
  update: [patch: Partial<Omit<Task, 'id' | 'milestoneId'>>]
  edit: []
  remove: []
  moveUp: []
  moveDown: []
  indent: []
  outdent: []
  addChild: []
}>()

const indentStyle = computed(() => ({ paddingLeft: `${(props.depth ?? 0) * 20}px` }))

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
  <div class="task-row" :class="{ 'task-row-done': done() }" :style="indentStyle">
    <CornerDownRight v-if="(depth ?? 0) > 0" :size="12" class="task-branch" />
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
    <n-button
      v-if="actions"
      size="tiny"
      quaternary
      title="缩进：变成上一个同级任务的子任务"
      :disabled="first || (depth ?? 0) >= 4"
      @click="emit('indent')"
    >
      <template #icon><IndentIncrease :size="14" /></template>
    </n-button>
    <n-button
      v-if="actions"
      size="tiny"
      quaternary
      title="提升：升到父任务的下一级"
      :disabled="!(depth ?? 0)"
      @click="emit('outdent')"
    >
      <template #icon><IndentDecrease :size="14" /></template>
    </n-button>
    <n-button
      v-if="actions"
      size="tiny"
      quaternary
      title="加子任务"
      :disabled="(depth ?? 0) >= 4"
      @click="emit('addChild')"
    >
      <template #icon><Plus :size="14" /></template>
    </n-button>
    <n-button
      v-if="actions"
      size="tiny"
      quaternary
      title="上移"
      :disabled="first"
      @click="emit('moveUp')"
    >
      <template #icon><ArrowUp :size="14" /></template>
    </n-button>
    <n-button
      v-if="actions"
      size="tiny"
      quaternary
      title="下移"
      :disabled="last"
      @click="emit('moveDown')"
    >
      <template #icon><ArrowDown :size="14" /></template>
    </n-button>
    <n-button v-if="actions" size="tiny" quaternary title="编辑任务" @click="emit('edit')">
      <template #icon><Pencil :size="14" /></template>
    </n-button>
    <n-popconfirm v-if="actions" @positive-click="emit('remove')">
      <template #trigger>
        <n-button size="tiny" quaternary type="error" title="删除任务">
          <template #icon><Trash2 :size="14" /></template>
        </n-button>
      </template>
      删除这个任务？无法恢复。
    </n-popconfirm>
  </div>
</template>

<style scoped>
.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}

.task-branch {
  flex: none;
  color: var(--app-faint);
}

.task-drag {
  display: inline-flex;
  align-items: center;
  color: var(--app-faint);
  cursor: grab;
  touch-action: none;
}

.task-drag:active {
  cursor: grabbing;
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
