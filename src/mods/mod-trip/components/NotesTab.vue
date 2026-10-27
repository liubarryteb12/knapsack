<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NInput, NPopconfirm } from 'naive-ui'
import { Trash2 } from '@lucide/vue'
import type { Trip } from '../schema'
import { useTripsStore } from '../store'

const props = defineProps<{ trip: Trip }>()
const tripsStore = useTripsStore()

const draft = ref(props.trip.notes)
const savedText = ref('')
const showSaved = ref(false)
const clearing = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null

// 切换旅行时：先冲刷旧旅行未保存的草稿，再载入新旅行内容
watch(
  () => props.trip.id,
  async (_newId, oldId) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
      await flushDraft(String(oldId))
    }
    draft.value = props.trip.notes
  },
)

watch(draft, (val) => {
  if (val === props.trip.notes) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    debounceTimer = null
    await flushDraft(props.trip.id)
  }, 1000) // 停止输入 1 秒后保存
})

/** 把当前草稿写回指定 id 的旅行（带 id 守卫，防止串写） */
async function flushDraft(tripId: string) {
  if (props.trip.id !== tripId) return
  if (draft.value === props.trip.notes) return
  props.trip.notes = draft.value
  await tripsStore.saveTrip(props.trip)
  savedText.value = '已自动保存'
  showSaved.value = true
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => (showSaved.value = false), 2000)
}

onBeforeUnmount(() => {
  // 卸载前冲刷未保存的草稿（同步判断，异步写入）
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
    void flushDraft(props.trip.id)
  }
  if (savedTimer) clearTimeout(savedTimer)
})

async function clearNotes() {
  clearing.value = true
  try {
    props.trip.notes = ''
    await tripsStore.saveTrip(props.trip)
    draft.value = ''
    savedText.value = '备忘已清空'
    showSaved.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => (showSaved.value = false), 2000)
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="notes">
    <div class="notes-header">
      <span class="muted small">自由备忘，停止输入 1 秒后自动保存</span>
      <div class="notes-actions">
        <transition name="fade">
          <span v-if="showSaved" class="saved-tip">{{ savedText }}</span>
        </transition>
        <n-popconfirm @positive-click="clearNotes">
          <template #trigger>
            <n-button
              quaternary
              circle
              size="small"
              type="error"
              :disabled="clearing"
              aria-label="清空备忘录"
            >
              <template #icon><Trash2 :size="15" /></template>
            </n-button>
          </template>
          确定清空全部备忘录？此操作不可恢复。
        </n-popconfirm>
      </div>
    </div>
    <n-input
      v-model:value="draft"
      type="textarea"
      :rows="16"
      placeholder="路线规划、预订编号、想吃的店……随手记"
    />
  </div>
</template>

<style scoped>
.notes {
  padding-top: 12px;
}

.notes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.saved-tip {
  color: var(--app-success);
  font-size: 12px;
}

.notes-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: 12px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
