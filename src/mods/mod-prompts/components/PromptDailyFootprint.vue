<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NCard, NTag } from 'naive-ui'
import { Sparkles } from '@lucide/vue'
import { toDateStr } from '../../../utils/date'
import { usePromptsStore } from '../store'

const props = defineProps<{
  logicalDate?: string
}>()

const store = usePromptsStore()

onMounted(() => {
  if (!store.loading && store.items.length === 0) void store.load()
})

const addedToday = computed(() => {
  if (!props.logicalDate) return []
  return store.items.filter((item) => toDateStr(new Date(item.createdAt)) === props.logicalDate)
})

const topUsed = computed(() =>
  [...store.items].sort((a, b) => b.usageCount - a.usageCount).find((item) => item.usageCount > 0),
)
</script>

<template>
  <n-card v-if="addedToday.length > 0 || topUsed" size="small" class="prompt-footprint">
    <div class="footprint-head">
      <span class="footprint-icon"><Sparkles :size="16" /></span>
      <strong>提示词足迹</strong>
    </div>
    <div class="footprint-meta">
      <n-tag v-if="addedToday.length > 0" size="small" :bordered="false">
        今日新增 {{ addedToday.length }} 条
      </n-tag>
      <span v-if="topUsed" class="muted">
        最常用：{{ topUsed.title }} · {{ topUsed.usageCount }} 次
      </span>
      <span v-else class="muted">还没有复制调用记录</span>
    </div>
  </n-card>
</template>

<style scoped>
.prompt-footprint {
  margin-top: var(--space-4);
}

.footprint-head,
.footprint-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.footprint-meta {
  margin-top: var(--space-2);
}

.footprint-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.muted {
  color: var(--app-muted);
  font-size: var(--text-sm);
}
</style>
