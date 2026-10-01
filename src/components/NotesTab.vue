<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { NInput } from 'naive-ui'
import type { Trip } from '../schema/trip'
import { useTripsStore } from '../stores/trips'

const props = defineProps<{ trip: Trip }>()
const tripsStore = useTripsStore()

const draft = ref(props.trip.notes)
const savedText = ref('')
const showSaved = ref(false)
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
</script>

<template>
  <div class="notes">
    <div class="notes-header">
      <span class="muted small">自由备忘，停止输入 1 秒后自动保存</span>
      <transition name="fade">
        <span v-if="showSaved" class="saved-tip">{{ savedText }}</span>
      </transition>
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
  color: #16a34a;
  font-size: 12px;
}

.muted {
  color: #9ca3af;
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
