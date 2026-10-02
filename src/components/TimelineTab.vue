<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NButton, NModal, NForm, NFormItem, NInput, NSelect, NTimePicker,
  NCheckbox, NDropdown, NEmpty,
} from 'naive-ui'
import { Undo2, Redo2, Plus, MoreHorizontal, GripVertical } from '@lucide/vue'
import type { Trip, TripItem, ItemType } from '../schema/trip'
import { nanoid } from 'nanoid'
import Sortable from 'sortablejs'
import { useTripsStore } from '../stores/trips'
import { useHistoryStore } from '../stores/history'
import { itemTypeOptions } from './itemMeta'
import { typeIcon } from './icons'

const props = defineProps<{ trip: Trip }>()
const tripsStore = useTripsStore()
const history = useHistoryStore()

const activeDay = ref(0)

watch(
  () => props.trip.id,
  () => {
    activeDay.value = 0
  },
)

/** 当前激活天 */
const currentDay = computed(() => props.trip.days[activeDay.value])

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
// 数据模型是唯一事实源：Sortable 拖完后先还原 DOM，再用数据驱动重渲染，
// 避免 Sortable 手改 DOM 与 Vue vdom 状态错位。
const timelineRoot = ref<HTMLElement | null>(null)
const sortableInstances: Sortable[] = []

function setupAllSortable() {
  sortableInstances.forEach((s) => s.destroy())
  sortableInstances.length = 0
  if (!timelineRoot.value) return
  timelineRoot.value.querySelectorAll<HTMLElement>('.day-items').forEach((el) => {
    const dayIndex = Number(el.dataset.day ?? -1)
    if (dayIndex < 0) return
    sortableInstances.push(
      Sortable.create(el, {
        group: 'timeline-items',
        animation: 150,
        handle: '.item-drag-handle',
        ghostClass: 'drag-ghost',
        onEnd(evt) {
          const fromDay = dayIndex
          const fromIndex = evt.oldIndex ?? -1
          const toEl = evt.to as HTMLElement | null
          const toDay = toEl ? Number(toEl.dataset.day ?? -1) : -1
          const itemEl = evt.item as HTMLElement
          const itemId = itemEl.dataset.id ?? ''
          // 还原 DOM：把拖动的元素放回原位，交给 Vue 重渲染
          if (evt.from !== evt.to) {
            const originFrom = evt.from as HTMLElement
            if (evt.clone && evt.clone.parentNode === evt.to) {
              // 跨容器时 Sortable 留了 clone，清掉
              evt.item.remove()
            }
            originFrom.insertBefore(evt.item, originFrom.children[fromIndex] ?? null)
          } else if (evt.oldIndex !== evt.newIndex) {
            const ref = evt.from.children[evt.oldIndex ?? evt.from.children.length] ?? null
            evt.from.insertBefore(evt.item, ref)
          }
          if (fromDay < 0 || fromIndex < 0 || toDay < 0 || itemId === '') return
          if (fromDay === toDay && evt.oldIndex === evt.newIndex) return
          void moveItem(fromDay, fromIndex, toDay, evt.newIndex ?? -1, itemId)
        },
      }),
    )
  })
}

async function moveItem(fromDay: number, fromIndex: number, toDay: number, toIndex: number, itemId: string) {
  await pushHistoryAndSave(() => {
    const src = props.trip.days[fromDay]
    const dst = props.trip.days[toDay]
    if (!src || !dst) return
    // 用 id 定位条目，避免索引在 DOM 还原后漂移
    const idx = src.items.findIndex((it) => it.id === itemId)
    const item = idx >= 0 ? src.items[idx] : src.items[fromIndex]
    if (item === undefined) return
    const realFrom = idx >= 0 ? idx : fromIndex
    src.items.splice(realFrom, 1)
    // 目标索引按"移除后"的语义修正：同天且移除位在插入位前，插到位移一
    let insertAt = toIndex
    if (fromDay === toDay && realFrom < toIndex) insertAt = toIndex - 1
    dst.items.splice(Math.max(0, Math.min(insertAt, dst.items.length)), 0, item)
  }, '移动条目')
}

onMounted(() => {
  nextTick(setupAllSortable)
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
      <!-- 天切换：横向日期 chips，滚动容器；天数多时也可横向滑 -->
      <div class="day-chips" role="tablist">
        <button
          v-for="(d, i) in trip.days"
          :key="d.date"
          class="day-chip"
          :class="{ active: i === activeDay }"
          role="tab"
          :aria-selected="i === activeDay"
          @click="activeDay = i"
        >
          <span class="day-chip-label">D{{ i + 1 }}</span>
          <span class="day-chip-date">{{ d.date.slice(5) }}</span>
        </button>
      </div>
      <div class="toolbar-right">
        <n-button size="small" :disabled="!canUndo" @click="undo">
          <template #icon><Undo2 :size="14" /></template>
          撤销
        </n-button>
        <n-button size="small" :disabled="!canRedo" @click="redo">
          <template #icon><Redo2 :size="14" /></template>
          重做
        </n-button>
        <n-button size="small" type="primary" @click="openCreate">
          <template #icon><Plus :size="14" /></template>
          添加条目
        </n-button>
      </div>
    </div>

    <n-empty v-if="trip.days.length === 0" description="没有行程日期，请检查起止日期" class="empty" />

    <div ref="timelineRoot" class="timeline">
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
          <div v-for="(item, ii) in day.items" :key="item.id" :data-id="item.id" class="item-row" :class="{ done: item.done }">
            <span class="item-drag-handle" title="拖拽排序"><GripVertical :size="14" :stroke-width="2" /></span>
            <n-checkbox :checked="item.done" @click.stop="toggleDone(item)" />
            <span class="item-icon" :data-type="item.type">
              <component :is="typeIcon[item.type]" :size="15" :stroke-width="2" />
            </span>
            <span class="item-time tnum">{{ item.time ?? '--:--' }}</span>
            <span class="item-title">{{ item.title }}</span>
            <span v-if="item.note" class="item-note">{{ item.note }}</span>
            <n-dropdown
              trigger="click"
              :options="rowActions"
              @select="(key: string) => onRowAction(key, ii)"
            >
              <n-button size="tiny" quaternary class="item-menu">
                <template #icon><MoreHorizontal :size="15" /></template>
              </n-button>
            </n-dropdown>
          </div>
          <p v-if="day.items.length === 0" class="empty-day">暂无安排，从其他天拖入或点上方添加</p>
        </div>
      </div>
    </div>

    <n-modal v-model:show="showEdit" preset="card" :title="editingIndex === null ? '添加条目' : '编辑条目'" style="width: min(420px, calc(100vw - 32px))">
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
  padding-top: var(--space-3);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

/* 天切换 chips：横向滚动，触屏友好 */
.day-chips {
  display: flex;
  gap: var(--space-1);
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  padding: 2px;
  scrollbar-width: none;
}

.day-chips::-webkit-scrollbar {
  display: none;
}

.day-chip {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  font: inherit;
}

.day-chip:hover {
  background: var(--app-hover-bg);
}

.day-chip.active {
  background: var(--app-accent-solid);
  border-color: var(--app-accent-solid);
  color: var(--app-accent-on);
}

.day-chip-label {
  font-size: var(--text-xs);
  font-weight: 700;
}

.day-chip-date {
  font-size: 11px;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}

.toolbar-right {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

.empty {
  margin-top: 80px;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.day-block {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  opacity: 0.55;
  transition: opacity var(--dur-fast) var(--ease);
}

.day-block.active {
  opacity: 1;
  border-color: var(--app-accent-border);
  background: var(--app-accent-surface);
}

.day-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.day-badge {
  background: var(--app-accent-solid);
  color: var(--app-accent-on);
  font-size: var(--text-xs);
  border-radius: var(--radius-sm);
  padding: 1px 7px;
  font-weight: 600;
}

.day-date {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.day-count {
  color: var(--app-muted-soft);
  font-size: var(--text-xs);
  margin-left: auto;
}

.day-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 40px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--app-card-bg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) 10px;
  font-size: var(--text-md);
  transition: box-shadow var(--dur-fast) var(--ease);
}

.item-row:hover {
  box-shadow: var(--shadow-sm);
}

.item-row.done .item-title {
  text-decoration: line-through;
  color: var(--app-muted-soft);
}

.item-row.done .item-time,
.item-row.done .item-note {
  color: var(--app-faint);
}

.item-drag-handle {
  cursor: grab;
  color: var(--app-faint);
  display: flex;
  align-items: center;
  user-select: none;
}

.item-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 类型节点色：与设计令牌对应 */
.item-icon[data-type='transport'] {
  background: var(--type-transport-soft);
  color: var(--type-transport);
}

.item-icon[data-type='stay'] {
  background: var(--type-stay-soft);
  color: var(--type-stay);
}

.item-icon[data-type='food'] {
  background: var(--type-food-soft);
  color: var(--type-food);
}

.item-icon[data-type='play'] {
  background: var(--type-play-soft);
  color: var(--type-play);
}

.item-icon[data-type='other'] {
  background: var(--type-other-soft);
  color: var(--type-other);
}

.item-time {
  color: var(--app-muted);
  font-size: var(--text-sm);
  min-width: 44px;
}

.item-title {
  font-weight: 500;
}

.item-note {
  color: var(--app-muted-soft);
  font-size: var(--text-xs);
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
  color: var(--app-faint);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-2) 0;
}

.drag-ghost {
  opacity: 0.4;
  background: var(--app-accent-soft);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 720px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-right {
    justify-content: flex-end;
  }
}
</style>
