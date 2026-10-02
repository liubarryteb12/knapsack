<script setup lang="ts">
/** 统一空状态：图标 + 标题 + 说明 + 动作（slot） */
import type { Component } from 'vue'
import { Backpack } from '@lucide/vue'

withDefaults(
  defineProps<{
    icon?: Component
    title: string
    description?: string
  }>(),
  { icon: () => Backpack },
)
</script>

<template>
  <div class="ui-empty">
    <div class="ui-empty-icon">
      <component :is="icon" :size="28" :stroke-width="1.6" />
    </div>
    <p class="ui-empty-title">{{ title }}</p>
    <p v-if="description" class="ui-empty-desc">{{ description }}</p>
    <div v-if="$slots.default" class="ui-empty-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-12) var(--space-4);
}

.ui-empty-icon {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  background: var(--app-accent-tint);
  color: var(--app-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-4);
}

.ui-empty-title {
  font-size: var(--text-lg);
  font-weight: 600;
}

.ui-empty-desc {
  margin-top: var(--space-2);
  color: var(--app-muted);
  font-size: var(--text-sm);
  max-width: 320px;
}

.ui-empty-actions {
  margin-top: var(--space-4);
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  justify-content: center;
}
</style>
