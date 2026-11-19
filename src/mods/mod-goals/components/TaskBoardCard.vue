<script setup lang="ts">
import { computed } from 'vue'
import { NSelect, NTag } from 'naive-ui'
import type { BoardRole, Task, TaskStatus } from '../schema'

const props = defineProps<{
  task: Task
  goalTitle: string
  milestoneTitle: string
  role: BoardRole | undefined
  tierLabel: string
  roles: BoardRole[]
}>()

const emit = defineEmits<{
  move: [status: TaskStatus]
  assign: [roleId: string | null]
}>()

const MOVE_OPTIONS: Array<{ label: string; value: TaskStatus }> = [
  { label: '→ 待办', value: 'todo' },
  { label: '→ 进行中', value: 'doing' },
  { label: '→ 已完成', value: 'done' },
  { label: '→ 已放弃', value: 'dropped' },
]

const roleOptions = computed(() =>
  props.roles.map((role) => ({ label: role.name, value: role.id })),
)

const done = () => props.task.status === 'done'
</script>

<template>
  <article class="board-card" :class="{ 'board-card-done': done() }">
    <header class="board-card-head">
      <p class="board-card-title">{{ task.title }}</p>
      <n-tag v-if="task.estimate" size="tiny" :bordered="false">{{ task.estimate }}</n-tag>
    </header>
    <p class="board-card-path">
      <span class="board-card-goal">{{ goalTitle }}</span>
      <span v-if="milestoneTitle" class="board-card-ms"> · {{ milestoneTitle }}</span>
    </p>

    <div class="board-card-foot">
      <n-select
        :value="task.roleId ?? ''"
        :options="[{ label: role ? '人格已失效' : '未分派', value: '' }, ...roleOptions]"
        size="tiny"
        class="board-card-role"
        :status="task.roleId && !role ? 'warning' : undefined"
        @update:value="(value: string) => emit('assign', value || null)"
      />
      <n-tag v-if="role && tierLabel" size="tiny" :bordered="false">{{ tierLabel }}</n-tag>
      <n-select
        :value="task.status"
        :options="MOVE_OPTIONS"
        size="tiny"
        class="board-card-move"
        @update:value="(value: TaskStatus) => emit('move', value)"
      />
    </div>
  </article>
</template>

<style scoped>
.board-card {
  background: var(--app-card-bg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.board-card-done .board-card-title {
  text-decoration: line-through;
  color: var(--app-muted);
}

.board-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}

.board-card-title {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.4;
  flex: 1;
  min-width: 0;
}

.board-card-path {
  margin: 0;
  color: var(--app-muted);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-card-goal {
  color: var(--app-accent);
}

.board-card-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.board-card-role {
  flex: 1;
  min-width: 0;
}

.board-card-move {
  flex: 0 0 auto;
  width: 110px;
}
</style>
