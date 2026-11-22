<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NModal,
  NPopconfirm,
  NProgress,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from '@lucide/vue'
import Sortable from 'sortablejs'
import TaskRow from './TaskRow.vue'
import { useGoalsStore } from '../store'
import {
  completionRatio,
  type Milestone,
  type MilestoneStatus,
  type Task,
  type TaskStatus,
} from '../schema'

const props = defineProps<{ goalId: string }>()

const store = useGoalsStore()
const message = useMessage()

const milestones = computed(() => store.milestonesOf(props.goalId))

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

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  dropped: '已放弃',
}

const taskStatusOptions = (Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((value) => ({
  label: TASK_STATUS_LABEL[value],
  value,
}))

const estimateOptions = [
  { label: 'S 小', value: 'S' },
  { label: 'M 中', value: 'M' },
  { label: 'L 大', value: 'L' },
]

const newTitle = ref('')
const newAcceptance = ref('')
const newTarget = ref('')
const taskDrafts = reactive<Record<string, string>>({})

function tasksOf(milestoneId: string): Task[] {
  return store.tasksOf(milestoneId)
}

interface TaskLine {
  task: Task
  depth: number
  first: boolean
  last: boolean
  hasChildren: boolean
}

/** 把任务树按深度优先展开成行，供列表渲染 */
function taskLines(milestoneId: string): TaskLine[] {
  const lines: TaskLine[] = []
  const walk = (parentId: string | undefined, depth: number): void => {
    const siblings = parentId ? store.childTasksOf(parentId) : store.rootTasksOf(milestoneId)
    siblings.forEach((task, index) => {
      const children = store.childTasksOf(task.id)
      lines.push({
        task,
        depth,
        first: index === 0,
        last: index === siblings.length - 1,
        hasChildren: children.length > 0,
      })
      if (children.length > 0) walk(task.id, depth + 1)
    })
  }
  walk(undefined, 0)
  return lines
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

// ---------- 子任务：缩进 / 提升 / 加子任务 ----------

const childDraftFor = ref<string | null>(null)
const childDraftText = ref('')

function openChildDraft(task: Task) {
  childDraftFor.value = task.id
  childDraftText.value = ''
}

async function submitChildDraft(task: Task) {
  const title = childDraftText.value.trim()
  childDraftFor.value = null
  if (!title) return
  try {
    await store.addTask(task.milestoneId, { title }, task.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function indentTask(task: Task) {
  try {
    await store.indentTask(task.id)
  } catch (error) {
    message.warning(error instanceof Error ? error.message : String(error))
  }
}

async function outdentTask(task: Task) {
  try {
    await store.outdentTask(task.id)
  } catch (error) {
    message.warning(error instanceof Error ? error.message : String(error))
  }
}

async function onTaskUpdate(task: Task, patch: Partial<Omit<Task, 'id' | 'milestoneId'>>) {
  await store.updateTask(task.id, patch)
}

// ---------- 里程碑：排序 / 删除 ----------

async function moveMilestone(index: number, delta: number) {
  const ids = milestones.value.map((m) => m.id)
  const target = index + delta
  if (target < 0 || target >= ids.length) return
  const [moved] = ids.splice(index, 1)
  if (moved === undefined) return
  ids.splice(target, 0, moved)
  await store.reorderMilestones(props.goalId, ids)
}

async function removeMilestone(milestone: Milestone) {
  try {
    await store.deleteMilestone(milestone.id)
    message.success('已删除里程碑')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

// ---------- 任务：排序 / 删除 / 编辑 ----------

async function moveTask(task: Task, delta: -1 | 1) {
  await store.moveSibling(task.id, delta)
}

async function removeTask(task: Task) {
  try {
    await store.deleteTask(task.id)
    message.success('已删除任务')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const showTaskEdit = ref(false)
const editingTask = ref<Task | null>(null)
const taskForm = reactive({
  title: '',
  detail: '',
  estimate: 'M' as Task['estimate'],
  dueDate: '',
  status: 'todo' as TaskStatus,
})

function openTaskEdit(task: Task) {
  editingTask.value = task
  taskForm.title = task.title
  taskForm.detail = task.detail
  taskForm.estimate = task.estimate
  taskForm.dueDate = task.dueDate ?? ''
  taskForm.status = task.status
  showTaskEdit.value = true
}

async function saveTaskEdit() {
  const task = editingTask.value
  if (!task) return
  const title = taskForm.title.trim()
  if (!title) {
    message.warning('任务标题不能为空')
    return
  }
  try {
    await store.updateTask(task.id, {
      title,
      detail: taskForm.detail,
      estimate: taskForm.estimate,
      dueDate: taskForm.dueDate || undefined,
      status: taskForm.status,
    })
    showTaskEdit.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

// ---------- 拖拽排序（桌面端），按钮排序兜底移动端 ----------

const root = ref<HTMLElement | null>(null)
const sortables: Sortable[] = []

function destroySortables() {
  sortables.forEach((instance) => instance.destroy())
  sortables.length = 0
}

/** 数据模型是唯一事实源：Sortable 改完 DOM 先还原，再交给 Vue 按数据重渲染 */
function restoreDom(evt: Sortable.SortableEvent) {
  const from = evt.oldIndex ?? -1
  const parent = evt.from as HTMLElement
  const item = evt.item as HTMLElement
  if (from >= 0 && evt.oldIndex !== evt.newIndex) {
    parent.insertBefore(item, parent.children[from] ?? null)
  }
}

function setupSortables() {
  destroySortables()
  if (!root.value) return

  const milestoneList = root.value.querySelector<HTMLElement>('[data-sortable="milestones"]')
  if (milestoneList) {
    sortables.push(
      Sortable.create(milestoneList, {
        animation: 150,
        handle: '.milestone-drag',
        draggable: '.milestone-card',
        ghostClass: 'drag-ghost',
        onEnd(evt) {
          restoreDom(evt)
          const from = evt.oldIndex ?? -1
          const to = evt.newIndex ?? -1
          if (from < 0 || to < 0 || from === to) return
          const ids = milestones.value.map((m) => m.id)
          const [moved] = ids.splice(from, 1)
          if (moved === undefined) return
          ids.splice(to, 0, moved)
          void store.reorderMilestones(props.goalId, ids)
        },
      }),
    )
  }

  // 任务行支持任意深度，拖拽会跨层级产生歧义；改用「缩进/提升/上下移」按钮
}

const orderSignature = computed(() =>
  milestones.value.map((milestone) => milestone.id).join('|'),
)

watch(orderSignature, () => nextTick(setupSortables))
onMounted(() => nextTick(setupSortables))
onBeforeUnmount(destroySortables)
</script>

<template>
  <div ref="root" class="milestone-list">
    <div v-if="milestones.length === 0" class="milestone-empty">
      还没有里程碑。先加一个能验证的阶段目标。
    </div>

    <div v-else class="milestone-sortable" data-sortable="milestones">
      <section v-for="(milestone, index) in milestones" :key="milestone.id" class="milestone-card">
        <header class="milestone-head">
          <span class="milestone-drag" title="拖动排序">
            <GripVertical :size="16" />
          </span>
          <n-input
            :default-value="milestone.title"
            size="small"
            :bordered="false"
            class="milestone-title"
            @blur="rename(milestone, $event)"
          />
          <n-button
            size="tiny"
            quaternary
            title="上移"
            :disabled="index === 0"
            @click="moveMilestone(index, -1)"
          >
            <template #icon><ArrowUp :size="14" /></template>
          </n-button>
          <n-button
            size="tiny"
            quaternary
            title="下移"
            :disabled="index === milestones.length - 1"
            @click="moveMilestone(index, 1)"
          >
            <template #icon><ArrowDown :size="14" /></template>
          </n-button>
          <n-select
            :value="milestone.status"
            :options="statusOptions"
            size="tiny"
            style="width: 96px"
            @update:value="(value: MilestoneStatus) => store.updateMilestone(milestone.id, { status: value })"
          />
          <n-popconfirm @positive-click="removeMilestone(milestone)">
            <template #trigger>
              <n-button size="tiny" quaternary type="error" title="删除里程碑">
                <template #icon><Trash2 :size="14" /></template>
              </n-button>
            </template>
            删除「{{ milestone.title }}」及其下所有任务？无法恢复。
          </n-popconfirm>
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
          <div class="milestone-task-list">
            <template v-for="line in taskLines(milestone.id)" :key="line.task.id">
              <TaskRow
                :task="line.task"
                :depth="line.depth"
                actions
                :first="line.first"
                :last="line.last"
                :has-children="line.hasChildren"
                @update="(patch) => onTaskUpdate(line.task, patch)"
                @edit="openTaskEdit(line.task)"
                @remove="removeTask(line.task)"
                @move-up="moveTask(line.task, -1)"
                @move-down="moveTask(line.task, 1)"
                @indent="indentTask(line.task)"
                @outdent="outdentTask(line.task)"
                @add-child="openChildDraft(line.task)"
              />
              <div
                v-if="childDraftFor === line.task.id"
                class="task-child-draft"
                :style="{ paddingLeft: `${(line.depth + 1) * 20}px` }"
              >
                <n-input
                  v-model:value="childDraftText"
                  size="small"
                  placeholder="子任务标题，回车保存"
                  autofocus
                  @keyup.enter="submitChildDraft(line.task)"
                  @blur="submitChildDraft(line.task)"
                />
              </div>
            </template>
          </div>
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
    </div>

    <section class="milestone-new">
      <h4>新增里程碑</h4>
      <n-input v-model:value="newTitle" size="small" placeholder="里程碑标题" />
      <n-input v-model:value="newAcceptance" size="small" placeholder="验收口径（必填，可验证）" />
      <input v-model="newTarget" class="milestone-date" type="date" />
      <n-button size="small" type="primary" :disabled="!newTitle.trim() || !newAcceptance.trim()" @click="addMilestone">
        添加里程碑
      </n-button>
    </section>

    <n-modal v-model:show="showTaskEdit" preset="card" title="编辑任务" style="max-width: 560px">
      <div class="task-edit-form">
        <label class="task-edit-field">
          <span>标题</span>
          <n-input v-model:value="taskForm.title" placeholder="动词开头，可独立执行" />
        </label>
        <label class="task-edit-field">
          <span>详情</span>
          <n-input
            v-model:value="taskForm.detail"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder="补充上下文、约束或完成方式"
          />
        </label>
        <div class="task-edit-row">
          <label class="task-edit-field">
            <span>状态</span>
            <n-select v-model:value="taskForm.status" :options="taskStatusOptions" style="width: 120px" />
          </label>
          <label class="task-edit-field">
            <span>工作量</span>
            <n-select v-model:value="taskForm.estimate" :options="estimateOptions" style="width: 120px" />
          </label>
          <label class="task-edit-field">
            <span>截止</span>
            <input v-model="taskForm.dueDate" class="milestone-date" type="date" />
          </label>
        </div>
      </div>
      <template #footer>
        <div class="task-edit-footer">
          <n-button @click="showTaskEdit = false">取消</n-button>
          <n-button type="primary" @click="saveTaskEdit">保存</n-button>
        </div>
      </template>
    </n-modal>
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

.milestone-sortable {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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
  flex-wrap: wrap;
}

.milestone-drag {
  display: inline-flex;
  align-items: center;
  color: var(--app-faint);
  cursor: grab;
  touch-action: none;
}

.milestone-drag:active {
  cursor: grabbing;
}

.milestone-title {
  flex: 1;
  min-width: 160px;
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

.milestone-task-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.milestone-add-task {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.task-child-draft {
  padding-top: 2px;
  padding-bottom: 2px;
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

.task-edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.task-edit-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--app-muted);
}

.task-edit-row {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.task-edit-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

:deep(.drag-ghost) {
  opacity: 0.4;
}
</style>
