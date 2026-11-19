<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NModal, NTag, useMessage } from 'naive-ui'
import { useGoalsStore } from '../store'
import type { DispatchAssignment, DispatchDraft } from '../schema'
import { runModerator, ModeratorError } from '../services/moderator'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const store = useGoalsStore()
const message = useMessage()

const visible = computed({
  get: () => props.show,
  set: (value: boolean) => emit('update:show', value),
})

const running = ref(false)
const draft = ref<DispatchDraft | null>(null)
const dropped = ref<Array<{ index: number; reason: string }>>([])
const conflicts = ref<string[]>([])
const checked = ref<Record<number, boolean>>({})
const allowReassign = ref(false)
const errorText = ref('')

const milestoneById = computed(() => new Map(store.milestones.map((m) => [m.id, m])))
const goalByMilestone = computed(() => {
  const map = new Map<string, string>()
  for (const milestone of store.milestones) {
    map.set(milestone.id, store.goalById(milestone.goalId)?.title ?? '')
  }
  return map
})

async function openMeeting() {
  running.value = true
  errorText.value = ''
  draft.value = null
  dropped.value = []
  conflicts.value = []
  checked.value = {}
  try {
    const activeIds = new Set(store.goals.filter((g) => g.status === 'active').map((g) => g.id))
    const activeMilestones = store.milestones.filter((m) => activeIds.has(m.goalId))
    const milestoneIds = new Set(activeMilestones.map((m) => m.id))
    const boardTasks = store.tasks.filter(
      (t) => milestoneIds.has(t.milestoneId) && (t.status === 'todo' || t.status === 'doing'),
    )
    const manualRoleByTask: Record<string, string> = {}
    for (const task of boardTasks) {
      if (task.roleId) manualRoleByTask[task.id] = task.roleId
    }

    const result = await runModerator({
      goals: store.goals
        .filter((g) => activeIds.has(g.id))
        .map((g) => ({ id: g.id, title: g.title, priority: g.priority })),
      roles: store.activeRoles,
      tasks: boardTasks,
      taskTitleOf: (id) => store.tasks.find((t) => t.id === id)?.title ?? '',
      goalTitleOf: (milestoneId) => goalByMilestone.value.get(milestoneId) ?? '',
      milestoneTitleOf: (milestoneId) => milestoneById.value.get(milestoneId)?.title ?? '',
      doingCountByRole: store.doingCountByRole,
      manualRoleByTask,
    })
    draft.value = result.draft
    dropped.value = result.dropped
    conflicts.value = result.conflicts
    // 默认勾选无冲突建议
    const conflictCountByRole = countConflictAssignments(result.draft.assignments, store.activeRoles, store.doingCountByRole)
    result.draft.assignments.forEach((item, index) => {
      checked.value[index] = conflictCountByRole.get(item.roleId) !== true
    })
    if (result.dropped.length > 0) {
      message.warning(`${result.dropped.length} 条建议因引用无效被丢弃`)
    }
  } catch (error) {
    errorText.value = error instanceof ModeratorError ? error.message : String(error)
  } finally {
    running.value = false
  }
}

function countConflictAssignments(
  assignments: DispatchAssignment[],
  roles: Array<{ id: string; maxDoing: number }>,
  doingCountByRole: Record<string, number>,
): Map<string, boolean> {
  const counts = new Map<string, number>()
  for (const item of assignments) {
    counts.set(item.roleId, (counts.get(item.roleId) ?? 0) + 1)
  }
  const over = new Map<string, boolean>()
  for (const role of roles) {
    const doing = doingCountByRole[role.id] ?? 0
    over.set(role.id, doing + (counts.get(role.id) ?? 0) > role.maxDoing)
  }
  return over
}

const taskTitleOf = (taskId: string) => store.tasks.find((t) => t.id === taskId)?.title ?? taskId.slice(0, 10)
const roleNameOf = (roleId: string) => store.roleById(roleId)?.name ?? roleId.slice(0, 10)
const currentRoleOf = (taskId: string) => {
  const roleId = store.tasks.find((t) => t.id === taskId)?.roleId
  return roleId ? roleNameOf(roleId) : '—'
}

const applicableCount = computed(() =>
  draft.value ? draft.value.assignments.filter((_, i) => checked.value[i]).length : 0,
)

async function applyChecked() {
  if (!draft.value) return
  try {
    const picked = draft.value.assignments.filter((_, i) => checked.value[i])
    await store.applyDispatch(picked)
    message.success(`已应用 ${picked.length} 条分派`)
    visible.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

defineExpose({ openMeeting })
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="主理人分派" style="max-width: 680px">
    <div v-if="!draft && !running" class="md-empty">
      <p>主理人会读取看板上的待办与进行中任务，对照人格职责给出分派草案。草案只是建议，确认后才会写库。</p>
      <n-button type="primary" :disabled="store.activeRoles.length === 0" @click="openMeeting">
        开始开会
      </n-button>
      <p v-if="store.activeRoles.length === 0" class="md-hint">先在「管理人格」里建立至少一个人格。</p>
    </div>

    <div v-else-if="running" class="md-running">主理人正在读看板……</div>

    <template v-else>
      <p v-if="errorText" class="md-error">{{ errorText }}</p>

      <template v-else>
        <label class="md-reassign">
          <n-checkbox v-model:checked="allowReassign" />
          允许主理人改动手动分派（默认保护）
        </label>

        <table class="md-table">
          <thead>
            <tr><th>应用</th><th>任务</th><th>当前人格</th><th>建议人格</th><th>特征</th><th>理由</th><th>冲突</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in draft!.assignments" :key="item.taskId">
              <td><n-checkbox v-model:checked="checked[index]" /></td>
              <td>{{ taskTitleOf(item.taskId) }}</td>
              <td>{{ currentRoleOf(item.taskId) }}</td>
              <td>{{ roleNameOf(item.roleId) }}</td>
              <td><n-tag v-for="trait in item.traits" :key="trait" size="tiny" :bordered="false">{{ trait }}</n-tag></td>
              <td class="md-reason">{{ item.reason }}</td>
              <td />
            </tr>
            <tr v-for="item in draft!.unassigned" :key="item.taskId">
              <td>—</td>
              <td>{{ taskTitleOf(item.taskId) }}</td>
              <td>—</td>
              <td>未分配</td>
              <td />
              <td class="md-reason">{{ item.reason }}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <p v-if="conflicts.length > 0" class="md-warning">
          容量冲突：{{ conflicts.join('；') }}（相关建议已取消勾选）
        </p>
        <p v-if="dropped.length > 0" class="md-warning">
          丢弃 {{ dropped.length }} 条：{{ dropped.map((d) => d.reason).join('；') }}
        </p>
        <p v-if="draft!.notes" class="md-notes">主理人备注：{{ draft!.notes }}</p>

        <div class="md-footer">
          <span>已勾选 {{ applicableCount }} 条</span>
          <span class="md-footer-space" />
          <n-button size="small" @click="visible = false">取消</n-button>
          <n-button size="small" type="primary" :disabled="applicableCount === 0" @click="applyChecked">
            应用勾选项
          </n-button>
        </div>
      </template>
    </template>
  </n-modal>
</template>

<style scoped>
.md-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}

.md-hint {
  color: var(--app-faint);
  font-size: var(--text-xs);
}

.md-running {
  color: var(--app-muted);
  padding: var(--space-6) 0;
  text-align: center;
}

.md-error {
  color: var(--app-danger, #dc2626);
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

.md-reassign {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--app-muted);
  margin-bottom: var(--space-3);
}

.md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.md-table th,
.md-table td {
  border-bottom: 1px solid var(--app-border);
  padding: var(--space-1) var(--space-2);
  text-align: left;
  vertical-align: top;
}

.md-reason {
  color: var(--app-muted);
  max-width: 180px;
}

.md-warning {
  color: var(--app-warning);
  font-size: var(--text-xs);
  margin-top: var(--space-2);
}

.md-notes {
  color: var(--app-muted);
  font-size: var(--text-xs);
  margin-top: var(--space-2);
}

.md-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.md-footer-space {
  flex: 1;
}
</style>
