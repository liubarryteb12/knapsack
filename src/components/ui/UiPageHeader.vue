<script setup lang="ts">
/** 页头：标题 + 副标题 + 右侧动作区；窄屏自动堆叠 */
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <div class="ui-page-header">
    <div class="ui-page-header-text">
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="ui-page-header-sub">{{ subtitle }}</p>
    </div>
    <div class="ui-page-header-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.ui-page-header-text {
  min-width: 0;
}

.ui-page-header h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.ui-page-header-sub {
  margin-top: var(--space-1);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.ui-page-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

@media (max-width: 720px) {
  .ui-page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .ui-page-header-actions > :deep(*) {
    flex: 1;
  }
}
</style>
