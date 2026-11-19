<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NSelect, NTag } from 'naive-ui'
import { LayoutDashboard, Sparkles, Users } from '@lucide/vue'
import TaskBoardCard from './TaskBoardCard.vue'
import RoleManagerModal from './RoleManagerModal.vue'
import UiEmptyState from '../../../components/ui/UiEmptyState.vue'
import { useGoalsStore } from '../store'
import type { RoleTier, Task, TaskStatus } from '../schema'

const store = useGoalsStore()

const emit = defineEmits<{
  'open-moderator': []
  'go-create': []
}>()

const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'todo', label: '待办' },
  { status: 'doing', label: '进行中' },
  { status: 'done', label: '已完成' },
]

const TIER_LABEL: Record<RoleTier, string> = {
  lead: '主责',
  specialist: '专职',
  helper: '辅助',
}

const filterGoalId = ref('')
const filterRoleId = ref('')
const groupBy = ref<'goal' | 'role'>('goal')
const showRoles = ref(false)

const goalOptions = computed(() => [
  { label: '全部目标', value: '' },
  ...store.goalsSorted
    .filter((goal) => goal.status === 'active')
    .map((goal) => ({ label: goal.title, value: goal.id })),
])

const roleOptions = computed(() => [
  { label: '全部人格', value: '' },
  ...store.activeRoles.map((role) => ({ label: role.name, value: role.id })),
])

const groupOptions = [
  { label: '按目标分组', value: 'goal' },
  { label: '按人格分组', value: 'role' },
]

function tasksInColumn(status: TaskStatus): Task[] {
  return store.boardTasksByStatus(
    status,
    filterGoalId.value || undefined,
    filterRoleId.value || undefined,
  )
}

function goalOf(task: Task) {
  const milestone = store.milestones.find((m) => m.id === task.milestoneId)
  return milestone ? store.goalById(milestone.goalId) : undefined
}

function milestoneTitleOf(task: Task): string {
  return store.milestones.find((m) => m.id === task.milestoneId)?.title ?? ''
}

function roleOf(task: Task) {
  return task.roleId ? store.roleById(task.roleId) : undefined
}

/** 分组键：按目标或按人格；「未分派」是独立组 */
function groupKeyOf(task: Task): string {
  if (groupBy.value === 'goal') {
    return goalOf(task)?.id ?? '?'
  }
  return task.roleId ?? '__none__'
}

function groupLabelOf(key: string): string {
  if (groupBy.value === 'goal') {
    return store.goalById(key)?.title ?? '未知目标'
  }
  if (key === '__none__') return '未分派'
  return store.roleById(key)?.name ?? '已失效人格'
}

function orderedGroupsInColumn(status: TaskStatus): Array<{ key: string; tasks: Task[] }> {
  const map = new Map<string, Task[]>()
  for (const task of tasksInColumn(status)) {
    const key = groupKeyOf(task)
    const list = map.get(key) ?? []
    list.push(task)
    map.set(key, list)
  }
  return [...map.entries()].map(([key, tasks]) => ({ key, tasks }))
}

async function onMove(task: Task, status: TaskStatus) {
  if (task.status === status) return
  const targetIds = tasksInColumn(status).map((t) => t.id)
  await store.moveTaskOnBoard(task.id, status, [...targetIds, task.id])
}

async function onAssign(task: Task, roleId: string | null) {
  await store.assignRole(task.id, roleId)
}
</script>

<template>
  <div class="board">
    <div class="board-toolbar">
      <n-select v-model:value="filterGoalId" :options="goalOptions" size="small" style="max-width: 220px" />
      <n-select v-model:value="filterRoleId" :options="roleOptions" size="small" style="max-width: 180px" />
      <n-select v-model:value="groupBy" :options="groupOptions" size="small" style="max-width: 140px" />
      <span class="board-toolbar-space" />
      <n-button size="small" @click="showRoles = true">
        <template #icon><Users :size="14" /></template>
        管理人格
      </n-button>
      <n-button size="small" type="primary" @click="emit('open-moderator')" :disabled="store.activeRoles.length === 0">
        <template #icon><Sparkles :size="14" /></template>
        主理人开会
      </n-button>
    </div>

    <div v-if="store.goalsSorted.length === 0">
      <UiEmptyState
        :icon="LayoutDashboard"
        title="还没有目标"
        description="看板展示「进行中」目标的任务。先去目标树创建并激活一个目标。"
      >
        <n-button size="small" type="primary" @click="$emit('go-create')">去创建目标</n-button>
      </UiEmptyState>
    </div>

    <template v-else>
      <div v-if="store.activeGoalsWithoutTasks.length > 0" class="board-hint">
        {{ store.activeGoalsWithoutTasks.length }} 个进行中目标还没有拆出任务，先去目标树拆解。
      </div>

      <div class="board-columns">
        <section v-for="column in COLUMNS" :key="column.status" class="board-column">
          <header class="board-column-head">
            <h4>{{ column.label }}</h4>
            <n-tag size="tiny" :bordered="false">{{ tasksInColumn(column.status).length }}</n-tag>
          </header>

          <template v-if="tasksInColumn(column.status).length === 0">
            <p class="board-empty">这一列没有任务。</p>
          </template>

          <div
            v-for="group in orderedGroupsInColumn(column.status)"
            :key="group.key"
            class="board-group"
          >
            <p v-if="groupBy === 'role' || orderedGroupsInColumn(column.status).length > 1" class="board-group-label">
              {{ groupLabelOf(group.key) }}
            </p>
            <TaskBoardCard
              v-for="task in group.tasks"
              :key="task.id"
              :task="task"
              :goal-title="goalOf(task)?.title ?? ''"
              :milestone-title="milestoneTitleOf(task)"
              :role="roleOf(task)"
              :tier-label="roleOf(task) ? TIER_LABEL[roleOf(task)!.tier] : ''"
              :roles="store.activeRoles"
              @move="(status) => onMove(task, status)"
              @assign="(roleId) => onAssign(task, roleId)"
            />
          </div>
        </section>
      </div>
    </template>

    <RoleManagerModal v-model:show="showRoles" />
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.board-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.board-toolbar-space {
  flex: 1;
}

.board-hint {
  color: var(--app-muted);
  font-size: var(--text-xs);
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-md);
}

.board-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  align-items: start;
}

.board-column {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-bg-soft);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 120px;
}

.board-column-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.board-column-head h4 {
  font-size: var(--text-md);
  font-weight: 600;
  margin: 0;
}

.board-empty {
  color: var(--app-faint);
  font-size: var(--text-xs);
}

.board-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.board-group-label {
  color: var(--app-muted);
  font-size: var(--text-xs);
  margin: var(--space-1) 0 0;
}

@media (max-width: 720px) {
  .board-columns {
    grid-template-columns: 1fr;
  }
}
</style>
