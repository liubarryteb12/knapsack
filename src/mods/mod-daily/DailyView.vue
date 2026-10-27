<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NInput,
  NModal,
  NPopconfirm,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  Pencil,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from '@lucide/vue'
import UiPageHeader from '../../components/ui/UiPageHeader.vue'
import ModSlot from '../../core/components/ModSlot.vue'
import { findTimeBlockConflicts } from '../../engines/timeline-engine/timeblock-scheduler'
import { addDays, todayStr } from '../../utils/date'
import DailyTimeline from './components/DailyTimeline.vue'
import { useDailyStore } from './store'
import { dailyDateSchema, type DailyTask } from './schema'

const store = useDailyStore()
const message = useMessage()

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') void store.flushSave()
}

onMounted(() => {
  void store.load(todayStr())
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  void store.flushSave()
})

const dayTitle = computed(() => {
  const d = new Date(`${store.currentDate}T00:00:00`)
  return d.toLocaleDateString('zh-CN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
})

const saveLabel = computed(() => {
  if (store.saving) return '保存中…'
  if (store.error) return `保存失败：${store.error}`
  if (!store.lastSavedAt) return '尚未保存'
  return `已自动保存 ${new Date(store.lastSavedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
})

const timelineConflicts = computed(() => {
  const blocks = (store.day?.tasks ?? []).flatMap((task) =>
    task.startMinute !== null && task.endMinute !== null
      ? [{ id: task.id, startMinute: task.startMinute, endMinute: task.endMinute }]
      : [],
  )
  return findTimeBlockConflicts(blocks)
})

async function moveDay(offset: number) {
  await store.load(addDays(store.currentDate, offset))
}

async function rolloverPrevious() {
  const moved = await store.rolloverFromPrevious()
  if (moved > 0) message.success(`已顺延 ${moved} 项未完成任务`)
  else message.info('没有可顺延的未完成任务')
}

async function onDateChange(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (dailyDateSchema.safeParse(value).success) await store.load(value)
}

const quickTitle = ref('')
const quickStart = ref('')
const adding = ref(false)

async function addQuickTask() {
  const title = quickTitle.value.trim()
  if (!title) {
    message.warning('先写一个任务标题')
    return
  }
  adding.value = true
  const task = await store.addTask({
    title,
    startTime: quickStart.value || null,
  })
  adding.value = false
  if (!task) {
    message.error(store.error || '任务保存失败')
    return
  }
  quickTitle.value = ''
  quickStart.value = ''
}

async function toggleTask(task: DailyTask) {
  if (!(await store.toggleTask(task.id))) message.error(store.error || '更新任务失败')
}

async function moveTaskTime(taskId: string, startMinute: number, endMinute: number) {
  if (!(await store.moveTaskTime(taskId, startMinute, endMinute))) {
    message.error(store.error || '时间块移动失败')
  }
}

const editingTask = ref<DailyTask | null>(null)
const editForm = ref({ title: '', startTime: '', endTime: '', note: '' })

function openEdit(task: DailyTask) {
  editingTask.value = task
  editForm.value = {
    title: task.title,
    startTime: task.startTime ?? '',
    endTime: task.endTime ?? '',
    note: task.note,
  }
}

async function saveEdit() {
  const task = editingTask.value
  if (!task) return
  const title = editForm.value.title.trim()
  if (!title) {
    message.warning('任务标题不能为空')
    return
  }
  const ok = await store.updateTask(task.id, {
    title,
    startTime: editForm.value.startTime || null,
    endTime: editForm.value.endTime || null,
    note: editForm.value.note,
  })
  if (!ok) {
    message.error(store.error || '任务保存失败')
    return
  }
  editingTask.value = null
  message.success('任务已更新')
}

async function removeTask(task: DailyTask) {
  if (!(await store.removeTask(task.id))) message.error(store.error || '删除任务失败')
}

const memoValue = computed({
  get: () => store.day?.memo ?? '',
  set: (value: string) => store.setMemo(value),
})

async function clearMemo() {
  if (!store.day?.memo) return
  await store.setMemo('')
  await store.flushSave()
  message.success('备忘录已清空')
}

const hasReview = computed(() => {
  const review = store.day?.review
  return !!(review && (review.wins || review.blockers || review.tomorrow))
})

async function clearReview() {
  if (!store.day?.review) return
  await store.setReview('wins', '')
  await store.setReview('blockers', '')
  await store.setReview('tomorrow', '')
  await store.flushSave()
  message.success('复盘已清空')
}

function taskTime(task: DailyTask): string {
  if (!task.startTime && !task.endTime) return '未安排时间'
  const overnight = task.endMinute !== null && task.endMinute > 24 * 60
  return `${task.startTime ?? '—'}${task.endTime ? `–${task.endTime}${overnight ? '（次日）' : ''}` : ''}`
}
</script>

<template>
  <div class="daily-page">
    <UiPageHeader title="每日规划" subtitle="把今天安排好，也给明天留一条清晰的路">
      <div class="date-nav">
        <div class="date-primary">
          <n-button quaternary circle aria-label="前一天" @click="moveDay(-1)">
            <template #icon><ChevronLeft :size="18" /></template>
          </n-button>
          <label class="date-picker">
            <CalendarDays :size="15" />
            <input :value="store.currentDate" type="date" @change="onDateChange" />
          </label>
          <n-button quaternary circle aria-label="后一天" @click="moveDay(1)">
            <template #icon><ChevronRight :size="18" /></template>
          </n-button>
        </div>
        <div class="date-actions">
          <n-button quaternary circle :disabled="!store.canUndo" title="撤销" @click="store.undo()">
            <template #icon><Undo2 :size="17" /></template>
          </n-button>
          <n-button quaternary circle :disabled="!store.canRedo" title="重做" @click="store.redo()">
            <template #icon><Redo2 :size="17" /></template>
          </n-button>
          <n-button size="small" @click="store.load(todayStr())">今天</n-button>
        </div>
      </div>
    </UiPageHeader>

    <div class="daily-meta">
      <div>
        <strong>{{ dayTitle }}</strong>
        <span class="muted"> · {{ store.currentDate }}</span>
      </div>
      <n-tag size="small" :bordered="false" :type="store.error ? 'error' : 'success'">
        {{ saveLabel }}
      </n-tag>
    </div>

    <ModSlot
      name="daily:header-banner"
      :slot-props="{ logicalDate: store.currentDate }"
    />

    <n-alert
      v-if="store.rolloverAvailable > 0"
      type="info"
      :bordered="false"
      class="rollover-banner"
    >
      昨日还有 {{ store.rolloverAvailable }} 项未完成。
      <n-button text type="primary" @click="rolloverPrevious">一键顺延到今日</n-button>
    </n-alert>

    <n-card size="small" class="section plan-card">
      <template #header>
        <div class="card-heading">
          <span>今日计划</span>
          <n-tag size="small" :bordered="false">
            {{ store.completedCount }} / {{ store.day?.tasks.length ?? 0 }} 完成
          </n-tag>
        </div>
      </template>

      <div class="quick-add">
        <n-input
          v-model:value="quickTitle"
          placeholder="加一件今天要做的事，例如：整理旅行照片"
          @keyup.enter="addQuickTask"
        />
        <input v-model="quickStart" class="time-input" type="time" aria-label="开始时间" />
        <n-button type="primary" :loading="adding" @click="addQuickTask">
          <template #icon><Plus :size="15" /></template>
          添加
        </n-button>
      </div>

      <div v-if="store.sortedTasks.length === 0" class="empty-plan">
        <Circle :size="22" />
        <span>今天还没有任务，从上面加一件小事开始。</span>
      </div>

      <DailyTimeline :tasks="store.day?.tasks ?? []" @move="moveTaskTime" />
      <n-alert
        v-if="timelineConflicts.length > 0"
        type="warning"
        :bordered="false"
        class="timeline-conflict"
      >
        发现 {{ timelineConflicts.length }} 处时间块重叠，请调整任务时间。
      </n-alert>

      <div v-for="task in store.sortedTasks" :key="task.id" class="task-row" :class="{ done: task.done }">
        <n-checkbox :checked="task.done" @update:checked="() => toggleTask(task)" />
        <div class="task-main">
          <div class="task-title-row">
            <span class="task-title">{{ task.title }}</span>
            <n-tag
              v-if="task.rolloverCount >= 3"
              size="tiny"
              type="warning"
              :bordered="false"
            >
              已延期 {{ task.rolloverCount }} 次
            </n-tag>
            <span class="task-time">{{ taskTime(task) }}</span>
          </div>
          <p v-if="task.note" class="task-note">{{ task.note }}</p>
        </div>
        <n-button quaternary circle size="small" aria-label="编辑任务" @click="openEdit(task)">
          <template #icon><Pencil :size="15" /></template>
        </n-button>
        <n-popconfirm @positive-click="removeTask(task)">
          <template #trigger>
            <n-button quaternary circle size="small" aria-label="删除任务">
              <template #icon><Trash2 :size="15" /></template>
            </n-button>
          </template>
          删除这项任务？
        </n-popconfirm>
      </div>
    </n-card>

    <div class="two-col">
      <n-card size="small" title="随手备忘录">
        <template #header-extra>
          <n-popconfirm @positive-click="clearMemo">
            <template #trigger>
              <n-button
                quaternary
                circle
                size="small"
                type="error"
                :disabled="!store.day?.memo"
                aria-label="清空备忘录"
              >
                <template #icon><Trash2 :size="15" /></template>
              </n-button>
            </template>
            确定清空今天的备忘录？此操作不可恢复。
          </n-popconfirm>
        </template>
        <n-input
          v-model:value="memoValue"
          type="textarea"
          :autosize="{ minRows: 7, maxRows: 16 }"
          placeholder="想到什么就先放这里，停止输入后自动保存。"
        />
      </n-card>

      <n-card size="small" title="每日复盘">
        <template #header-extra>
          <n-popconfirm @positive-click="clearReview">
            <template #trigger>
              <n-button
                quaternary
                circle
                size="small"
                type="error"
                :disabled="!hasReview"
                aria-label="清空每日复盘"
              >
                <template #icon><Trash2 :size="15" /></template>
              </n-button>
            </template>
            确定清空今天的复盘？此操作不可恢复。
          </n-popconfirm>
        </template>
        <div class="review-field">
          <label>今天做得好的</label>
          <n-input
            :value="store.day?.review.wins ?? ''"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="哪怕只完成了一件小事"
            @update:value="(v: string) => store.setReview('wins', v)"
          />
        </div>
        <div class="review-field">
          <label>今天卡住的</label>
          <n-input
            :value="store.day?.review.blockers ?? ''"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="写下来，明天少绕一点路"
            @update:value="(v: string) => store.setReview('blockers', v)"
          />
        </div>
        <div class="review-field">
          <label>明天最重要的一件事</label>
          <n-input
            :value="store.day?.review.tomorrow ?? ''"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="只写一件"
            @update:value="(v: string) => store.setReview('tomorrow', v)"
          />
        </div>
      </n-card>
    </div>

    <ModSlot
      name="daily:review-footer"
      :slot-props="{ logicalDate: store.currentDate }"
    />

    <n-modal
      :show="!!editingTask"
      preset="card"
      title="编辑任务"
      style="width: min(480px, calc(100vw - 32px))"
      @update:show="(v: boolean) => { if (!v) editingTask = null }"
    >
      <div class="edit-form">
        <label>任务标题</label>
        <n-input v-model:value="editForm.title" placeholder="任务标题" />
        <div class="time-grid">
          <label>
            开始
            <input v-model="editForm.startTime" class="time-input" type="time" />
          </label>
          <label>
            结束
            <input v-model="editForm.endTime" class="time-input" type="time" />
          </label>
        </div>
        <label>备注</label>
        <n-input v-model:value="editForm.note" type="textarea" :rows="3" placeholder="补充说明（可选）" />
      </div>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="editingTask = null">取消</n-button>
          <n-button type="primary" @click="saveEdit">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.daily-page {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-6);
}

.date-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.date-primary,
.date-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.date-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-card-bg);
  color: var(--app-muted);
}

.date-picker input {
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--app-text);
  font: inherit;
}

.daily-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: calc(var(--space-3) * -1) 0 var(--space-4);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.daily-meta strong {
  color: var(--app-text);
  font-size: var(--text-lg);
}

.section {
  margin-bottom: var(--space-4);
}

.rollover-banner {
  margin-bottom: var(--space-4);
}

.card-heading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.quick-add {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.quick-add :deep(.n-input) {
  flex: 1;
}

.time-input {
  min-height: 34px;
  padding: 4px 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-card-bg);
  color: var(--app-text);
  font: inherit;
}

.empty-plan {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-3);
  color: var(--app-muted-soft);
  font-size: var(--text-sm);
}

.timeline-conflict {
  margin-bottom: var(--space-3);
}

.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--app-border);
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.task-title {
  font-weight: 600;
}

.task-time {
  flex-shrink: 0;
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.task-note {
  margin: var(--space-1) 0 0;
  color: var(--app-muted);
  font-size: var(--text-xs);
  white-space: pre-wrap;
}

.task-row.done .task-title {
  color: var(--app-muted-soft);
  text-decoration: line-through;
}

.two-col {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-4);
}

.review-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.review-field label,
.edit-form > label,
.time-grid label {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.time-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.time-grid label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.muted {
  color: var(--app-muted);
}

@media (max-width: 720px) {
  .daily-page {
    padding: var(--space-4);
  }

  .date-nav {
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .date-picker {
    flex: 1;
    justify-content: center;
    min-width: 0;
  }

  .date-primary {
    flex: 1 1 100%;
  }

  .date-actions {
    margin-left: auto;
  }

  .quick-add {
    flex-wrap: wrap;
  }

  .quick-add :deep(.n-input) {
    flex-basis: 100%;
  }

  .quick-add .time-input {
    flex: 1;
  }

  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
