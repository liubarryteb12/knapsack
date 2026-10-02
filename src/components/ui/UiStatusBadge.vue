<script setup lang="ts">
/** 行程状态徽标：按今天与起止日期比较得出 */
import { computed } from 'vue'
import { todayStr } from '../../utils/date'

const props = defineProps<{
  startDate: string
  endDate: string
}>()

type Status = 'upcoming' | 'ongoing' | 'ended'

const status = computed<Status>(() => {
  const today = todayStr()
  if (today < props.startDate) return 'upcoming'
  if (today > props.endDate) return 'ended'
  return 'ongoing'
})

const label = computed(
  () => ({ upcoming: '未开始', ongoing: '进行中', ended: '已结束' })[status.value],
)
</script>

<template>
  <span class="ui-status-badge" :data-status="status">{{ label }}</span>
</template>

<style scoped>
.ui-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
}

/* 状态点 */
.ui-status-badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.ui-status-badge[data-status='upcoming'] {
  color: var(--app-warning);
  background: var(--app-warning-soft);
}

.ui-status-badge[data-status='ongoing'] {
  color: var(--app-success);
  background: var(--app-success-soft);
}

.ui-status-badge[data-status='ended'] {
  color: var(--app-muted);
  background: var(--app-chip-bg);
}
</style>
