<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NButton, NModal, NForm, NFormItem, NInput, NSelect, NTimePicker,
  NCheckbox, NDropdown, NEmpty,
} from 'naive-ui'
import type { Trip, TripItem, ItemType } from '../schema/trip'
import { nanoid } from 'nanoid'
import Sortable from 'sortablejs'
import { useTripsStore } from '../stores/trips'
import { useHistoryStore } from '../stores/history'
import { itemTypeOptions, typeIcon } from './itemMeta'

const props = defineProps<{ trip: Trip }>()
const tripsStore = useTripsStore()
const history = useHistoryStore()

const activeDay = ref(0)
const sortableInstances: Sortable[] = []

watch(
  () => props.trip.id,
  () => {
    activeDay.value = 0
  },
)

/** 当前激活天 */
const currentDay = computed(() => props.trip.days[activeDay.value])

const dayTabOptions = computed(() =>
  props.trip.days.map((d, i) => ({
    label: `D${i + 1} ${d.date.slice(5)}`,
    value: i,
  })),
)

// ---- 条目编辑 ----
const showEdit = ref(false)
const editForm = ref({
  time: null as string | null,
  type: 'play' as ItemType,
  title: '',
  note: '',
  done: false,
})
const editingIndex = ref<number | null>(null)

function openCreate() {
  editingIndex.value = null
  editForm.value = { time: null, type: 'play', title: '', note: '', done: false }
  showEdit.value = true
}

function openEdit(index: number) {
  const item = currentDay.value?.items[index]
  if (!item) return
  editingIndex.value = index
  editForm.value = {
    time: item.time,
    type: item.type,
    title: item.title,
    note: item.note,
    done: item.done,
  }
  showEdit.value = true
}

async function submitEdit() {
  const title = editForm.value.title.trim()
  if (!title) return
  await pushHistoryAndSave(() => {
    const day = props.trip.days[activeDay.value]
    if (!day) return
    if (editingIndex.value === null) {
      const item: TripItem = {
        id: nanoid(10),
        time: editForm.value.time,
        type: editForm.value.type,
        title,
        note: editForm.value.note.trim(),
        linkedExpenseId: null,
        done: false,
      }
      day.items.push(item)
    } else {
      const item = day.items[editingIndex.value]
      if (item) {
        item.time = editForm.value.time
        item.type = editForm.value.type
        item.title = title
        item.note = editForm.value.note.trim()
        item.done = editForm.value.done
      }
    }
  }, editingIndex.value === null ? '添加条目' : '修改条目')
  showEdit.value = false
}

async function removeItem(index: number) {
  await pushHistoryAndSave(() => {
    const day = props.trip.days[activeDay.value]
    if (!day) return
    day.items.splice(index, 1)
  }, '删除条目')
}

async function toggleDone(item: TripItem) {
  await pushHistoryAndSave(() => {
    item.done = !item.done
  }, '勾选条目')
}

// ---- 撤销/重做 ----
async function pushHistoryAndSave(mutate: () => void, label: string) {
  history.push(props.trip, label)
  mutate()
  await tripsStore.saveTrip(props.trip)
}

async function undo() {
  await history.undo(props.trip.id)
}

async function redo() {
  await history.redo(props.trip.id)
}

const canUndo = computed(() => history.canUndo(props.trip.id))
const canRedo = computed(() => history.canRedo(props.trip.id))

// ---- 拖拽（天内排序 + 跨天移动） ----
let dragFromDay = -1
let dragFromIndex = -1

function setupSortable(el: HTMLElement, dayIndex: number) {
  const sortable = Sortable.create(el, {
    group: 'timeline-items',
    animation: 150,
    handle: '.item-drag-handle',
    ghostClass: 'drag-ghost',
    onStart(evt) {
      dragFromDay = dayIndex
      dragFromIndex = evt.oldIndex ?? -1
    },
    async onEnd(evt) {
      const toDay = dayIndexOfEl(evt.to)
      const toIndex = evt.newIndex ?? -1
      if (dragFromDay < 0 || dragFromIndex < 0 || toDay < 0 || toIndex < 0) return
      if (dragFromDay === toDay && dragFromIndex === toIndex) return
      await moveItem(dragFromDay, dragFromIndex, toDay, toIndex)
      dragFromDay = -1
      dragFromIndex = -1
    },
  })
  sortableInstances.push(sortable)
}

function dayIndexOfEl(el: HTMLElement): number {
  const dayBlock = el.closest('.day-items')
  if (!dayBlock) return -1
  const idx = Array.from(document.querySelectorAll('.day-items')).indexOf(dayBlock)
  return idx
}

async function moveItem(fromDay: number, fromIndex: number, toDay: number, toIndex: number) {
  await pushHistoryAndSave(() => {
    const src = props.trip.days[fromDay]
    const dst = props.trip.days[toDay]
    const item = src?.items[fromIndex]
    if (!src || !dst || !item) return
    src.items.splice(fromIndex, 1)
    dst.items.splice(toIndex, 0, item)
  }, '移动条目')
}

onMounted(() => {
  nextTick(() => {
    document.querySelectorAll<HTMLElement>('.day-items').forEach((el, i) => {
      setupSortable(el, i)
    })
  })
})

onBeforeUnmount(() => {
  sortableInstances.forEach((s) => s.destroy())
  sortableInstances.length = 0
})

const rowActions = [
  { label: '编辑', key: 'edit' },
  { label: '删除', key: 'delete' },
]

async function onRowAction(key: string, index: number) {
  if (key === 'edit') openEdit(index)
  else if (key === 'delete') await removeItem(index)
}
</script>

<template>
  <div class="timeline-wrap">
    <div class="toolbar">
      <n-select v-model:value="activeDay" :options="dayTabOptions" class="day-select" />
      <div class="toolbar-right">
        <n-button size="small" :disabled="!canUndo" @click="undo">↩ 撤销</n-button>
        <n-button size="small" :disabled="!canRedo" @click="redo">↪ 重做</n-button>
        <n-button size="small" type="primary" @click="openCreate">+ 添加条目</n-button>
      </div>
    </div>

    <n-empty v-if="trip.days.length === 0" description="没有行程日期，请检查起止日期" class="empty" />

    <div class="timeline">
      <div
        v-for="(day, di) in trip.days"
        :key="day.date"
        class="day-block"
        :class="{ active: di === activeDay }"
        @click="activeDay = di"
      >
        <div class="day-header">
          <span class="day-badge">D{{ di + 1 }}</span>
          <span class="day-date">{{ day.date }}</span>
          <span class="day-count">{{ day.items.length }} 项</span>
        </div>
        <div class="day-items" :data-day="di">
          <div v-for="(item, ii) in day.items" :key="item.id" class="item-row" :class="{ done: item.done }">
            <span class="item-drag-handle" title="拖拽排序">⋮⋮</span>
            <n-checkbox :checked="item.done" @click.stop="toggleDone(item)" />
            <span class="item-icon">{{ typeIcon[item.type] }}</span>
            <span class="item-time">{{ item.time ?? '--:--' }}</span>
            <span class="item-title">{{ item.title }}</span>
            <span v-if="item.note" class="item-note">{{ item.note }}</span>
            <n-dropdown
              trigger="click"
              :options="rowActions"
              @select="(key: string) => onRowAction(key, ii)"
            >
              <n-button size="tiny" quaternary class="item-menu">⋯</n-button>
            </n-dropdown>
          </div>
          <p v-if="day.items.length === 0" class="empty-day">暂无安排，从其他天拖入或点上方添加</p>
        </div>
      </div>
    </div>

    <n-modal v-model:show="showEdit" preset="card" :title="editingIndex === null ? '添加条目' : '编辑条目'" style="width: 420px">
      <n-form label-placement="left" label-width="60">
        <n-form-item label="类型">
          <n-select v-model:value="editForm.type" :options="itemTypeOptions" />
        </n-form-item>
        <n-form-item label="时间">
          <n-time-picker
            :formatted-value="editForm.time"
            format="HH:mm"
            clearable
            @update:formatted-value="(v: string | null) => (editForm.time = v)"
          />
        </n-form-item>
        <n-form-item label="标题">
          <n-input v-model:value="editForm.title" placeholder="例如：高铁去杭州" @keyup.enter="submitEdit" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="editForm.note" type="textarea" :rows="2" placeholder="例如：G7349 虹桥 8:12 开" />
        </n-form-item>
        <n-form-item v-if="editingIndex !== null" label="完成">
          <n-checkbox v-model:checked="editForm.done">已完成</n-checkbox>
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" @click="submitEdit">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.timeline-wrap {
  padding-top: 12px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.day-select {
  width: 180px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.empty {
  margin-top: 80px;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.day-block {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  opacity: 0.55;
  transition: opacity 0.15s;
}

.day-block.active {
  opacity: 1;
  border-color: #c7d2fe;
  background: #fafaff;
}

.day-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.day-badge {
  background: #4338ca;
  color: #fff;
  font-size: 12px;
  border-radius: 6px;
  padding: 1px 7px;
  font-weight: 600;
}

.day-date {
  font-weight: 600;
}

.day-count {
  color: #9ca3af;
  font-size: 12px;
  margin-left: auto;
}

.day-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 40px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border: 1px solid #eceef1;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
}

.item-row.done .item-title {
  text-decoration: line-through;
  color: #9ca3af;
}

.item-row.done .item-time,
.item-row.done .item-note {
  color: #d1d5db;
}

.item-drag-handle {
  cursor: grab;
  color: #c0c4cc;
  letter-spacing: -2px;
  user-select: none;
  font-size: 13px;
}

.item-icon {
  font-size: 16px;
}

.item-time {
  font-variant-numeric: tabular-nums;
  color: #6b7280;
  font-size: 13px;
  min-width: 44px;
}

.item-title {
  font-weight: 500;
}

.item-note {
  color: #9ca3af;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.item-menu {
  margin-left: auto;
}

.item-row .item-note + .item-menu {
  margin-left: 0;
}

.empty-day {
  color: #c0c4cc;
  font-size: 13px;
  text-align: center;
  padding: 8px 0;
}

.drag-ghost {
  opacity: 0.4;
  background: #e0e7ff;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
