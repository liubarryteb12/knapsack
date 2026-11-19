<script setup lang="ts">
import { computed } from 'vue'
import { NProgress, NTag } from 'naive-ui'
import { ChevronRight, Target } from '@lucide/vue'
import type { Goal } from '../schema'

const props = defineProps<{
  goal: Goal
  progress: number | null
  milestoneCount: number
  taskCount: number
}>()

defineEmits<{ open: [] }>()

const STATUS_LABEL: Record<Goal['status'], string> = {
  draft: '草稿',
  active: '进行中',
  paused: '暂停',
  done: '已完成',
  abandoned: '已放弃',
}

const percent = computed(() => (props.progress === null ? 0 : Math.round(props.progress * 100)))
const progressLabel = computed(() =>
  props.progress === null ? '未拆解' : `${props.taskCount} 个任务 · ${percent.value}%`,
)
</script>

<template>
  <article class="goal-card" role="button" tabindex="0" @click="$emit('open')" @keydown.enter="$emit('open')">
    <div class="goal-card-head">
      <span class="goal-card-icon"><Target :size="18" :stroke-width="2" /></span>
      <div class="goal-card-title-wrap">
        <h3>{{ goal.title }}</h3>
        <p v-if="goal.why" class="goal-card-why">{{ goal.why }}</p>
      </div>
      <ChevronRight :size="18" class="goal-card-arrow" />
    </div>

    <div class="goal-card-meta">
      <n-tag size="small" :type="goal.status === 'active' ? 'success' : goal.status === 'done' ? 'info' : 'default'">
        {{ STATUS_LABEL[goal.status] }}
      </n-tag>
      <n-tag size="small" :bordered="false">{{ milestoneCount }} 里程碑</n-tag>
      <span v-if="goal.targetDate" class="goal-card-date">{{ goal.targetDate }}</span>
    </div>

    <div class="goal-card-progress">
      <n-progress
        type="line"
        :percentage="percent"
        :height="6"
        :show-indicator="false"
        :status="percent === 100 ? 'success' : 'default'"
      />
      <span class="goal-card-progress-label">{{ progressLabel }}</span>
    </div>
  </article>
</template>

<style scoped>
.goal-card {
  background: var(--app-card-bg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}

.goal-card:hover,
.goal-card:focus-visible {
  border-color: var(--app-accent-border);
  box-shadow: var(--shadow-sm);
  outline: none;
}

.goal-card-head {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

.goal-card-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: var(--radius-md);
  background: var(--app-accent-tint);
  color: var(--app-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.goal-card-title-wrap {
  min-width: 0;
  flex: 1;
}

.goal-card-title-wrap h3 {
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 1.35;
}

.goal-card-why {
  margin-top: 2px;
  color: var(--app-muted);
  font-size: var(--text-sm);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.goal-card-arrow {
  color: var(--app-faint);
  flex: 0 0 auto;
}

.goal-card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  flex-wrap: wrap;
}

.goal-card-date {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.goal-card-progress {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.goal-card-progress :deep(.n-progress) {
  flex: 1;
}

.goal-card-progress-label {
  color: var(--app-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}
</style>
