<script setup lang="ts">
/** 统计块：图标徽章 + 数值 + 标签 */
import type { Component } from 'vue'

defineProps<{
  icon: Component
  label: string
  value: string
}>()
</script>

<template>
  <div class="ui-stat-card">
    <div class="ui-stat-icon">
      <component :is="icon" :size="18" :stroke-width="2" />
    </div>
    <div class="ui-stat-body">
      <span class="ui-stat-value tnum">{{ value }}</span>
      <span class="ui-stat-label">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.ui-stat-card {
  flex: 1;
  min-width: 140px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  background: var(--app-card-bg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  box-shadow: var(--shadow-sm);
}

.ui-stat-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--app-accent-tint);
  color: var(--app-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ui-stat-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ui-stat-value {
  font-size: var(--text-lg);
  font-weight: 700;
  line-height: 1.3;
}

.ui-stat-label {
  color: var(--app-muted);
  font-size: var(--text-xs);
}
</style>
