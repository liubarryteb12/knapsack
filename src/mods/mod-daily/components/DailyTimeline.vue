<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { DailyTask } from '../schema'

const props = defineProps<{
  tasks: DailyTask[]
}>()

const AXIS_END = 27 * 60
const SNAP_MINUTES = 15
const ticks = [
  { minute: 0, label: '00' },
  { minute: 6 * 60, label: '06' },
  { minute: 12 * 60, label: '12' },
  { minute: 18 * 60, label: '18' },
  { minute: 24 * 60, label: '24' },
  { minute: 27 * 60, label: '03' },
]

const scheduled = computed(() =>
  props.tasks.filter(
    (task): task is DailyTask & { startMinute: number; endMinute: number } =>
      task.startMinute !== null && task.endMinute !== null,
  ),
)
const track = ref<HTMLElement | null>(null)
const preview = ref<{ taskId: string; startMinute: number; endMinute: number } | null>(null)
const emit = defineEmits<{
  move: [taskId: string, startMinute: number, endMinute: number]
}>()

let drag: {
  taskId: string
  pointerId: number
  startX: number
  originalStart: number
  originalEnd: number
  previewStart: number
  previewEnd: number
} | null = null

function displayedStart(task: DailyTask & { startMinute: number; endMinute: number }) {
  return preview.value?.taskId === task.id ? preview.value.startMinute : task.startMinute
}

function displayedEnd(task: DailyTask & { startMinute: number; endMinute: number }) {
  return preview.value?.taskId === task.id ? preview.value.endMinute : task.endMinute
}

function blockStyle(task: DailyTask & { startMinute: number; endMinute: number }) {
  const start = displayedStart(task)
  const end = displayedEnd(task)
  return {
    left: `${(start / AXIS_END) * 100}%`,
    width: `${Math.max(0.4, ((end - start) / AXIS_END) * 100)}%`,
  }
}

function tickStyle(minute: number) {
  return { left: `${(minute / AXIS_END) * 100}%` }
}

function taskTime(task: DailyTask): string {
  if (preview.value?.taskId === task.id) {
    const start = preview.value.startMinute
    const end = preview.value.endMinute
    const format = (value: number) => {
      const minute = value % 1440
      return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    }
    return `${format(start)}–${format(end)}${end > 1440 ? ' 次日' : ''}`
  }
  return `${task.startTime ?? ''}–${task.endTime ?? ''}${task.endMinute !== null && task.endMinute > 1440 ? ' 次日' : ''}`
}

function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId || !track.value) return
  const width = track.value.getBoundingClientRect().width
  const deltaMinutes = Math.round(
    ((event.clientX - drag.startX) / Math.max(1, width)) * AXIS_END / SNAP_MINUTES,
  ) * SNAP_MINUTES
  const duration = drag.originalEnd - drag.originalStart
  const start = Math.max(0, Math.min(1440, drag.originalStart + deltaMinutes))
  const end = Math.min(1620, start + duration)
  drag.previewStart = end - duration
  drag.previewEnd = end
  preview.value = {
    taskId: drag.taskId,
    startMinute: end - duration,
    endMinute: end,
  }
  event.preventDefault()
}

function finishDrag(event?: PointerEvent) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return
  const completed = drag
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', finishDrag)
  preview.value = null
  if (
    completed.previewStart !== completed.originalStart ||
    completed.previewEnd !== completed.originalEnd
  ) {
    emit('move', completed.taskId, completed.previewStart, completed.previewEnd)
  }
}

function beginDrag(
  event: PointerEvent,
  task: DailyTask & { startMinute: number; endMinute: number },
) {
  if (event.button !== 0) return
  drag = {
    taskId: task.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    originalStart: task.startMinute,
    originalEnd: task.endMinute,
    previewStart: task.startMinute,
    previewEnd: task.endMinute,
  }
  preview.value = {
    taskId: task.id,
    startMinute: task.startMinute,
    endMinute: task.endMinute,
  }
  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', finishDrag)
  window.addEventListener('pointercancel', finishDrag)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', finishDrag)
})
</script>

<template>
  <div v-if="scheduled.length > 0" class="daily-timeline">
    <div ref="track" class="timeline-track">
      <div
        v-for="task in scheduled"
        :key="task.id"
        class="timeline-block"
        :class="{ done: task.done }"
        :style="blockStyle(task)"
        :title="`${task.title} · ${taskTime(task)}`"
        @pointerdown="beginDrag($event, task)"
      />
      <span
        v-for="tick in ticks"
        :key="tick.minute"
        class="timeline-tick"
        :class="{ midnight: tick.minute === 1440 }"
        :style="tickStyle(tick.minute)"
      />
    </div>
    <div class="timeline-labels">
      <span
        v-for="tick in ticks"
        :key="tick.label"
        :style="tickStyle(tick.minute)"
      >
        {{ tick.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.daily-timeline {
  margin: var(--space-3) 0;
  padding: var(--space-3) 0 0;
}

.timeline-track {
  position: relative;
  height: 40px;
  overflow: hidden;
  border-radius: var(--radius-md);
  background:
    linear-gradient(90deg, var(--app-accent-tint) 0 88.888%, var(--app-chip-bg) 88.888% 100%);
}

.timeline-block {
  position: absolute;
  top: 8px;
  bottom: 8px;
  min-width: 2px;
  border-radius: 4px;
  background: var(--app-accent-solid);
  opacity: 0.78;
  transition: opacity var(--dur-fast) var(--ease);
  cursor: grab;
  touch-action: none;
}

.timeline-block:active {
  cursor: grabbing;
}

.timeline-block:hover {
  opacity: 1;
}

.timeline-block.done {
  background: var(--app-success);
  opacity: 0.58;
}

.timeline-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--app-border);
  opacity: 0.75;
}

.timeline-tick.midnight {
  background: var(--app-warning, #d97706);
  opacity: 0.9;
}

.timeline-labels {
  position: relative;
  height: 18px;
  margin-top: 4px;
  color: var(--app-faint);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.timeline-labels span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}

.timeline-labels span:first-child {
  transform: none;
}

.timeline-labels span:last-child {
  transform: translateX(-100%);
}
</style>
