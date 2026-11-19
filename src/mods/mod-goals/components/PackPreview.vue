<script setup lang="ts">
import { NAlert, NTag } from 'naive-ui'
import type { ImportPlan } from '../services/parseGoalPack'

defineProps<{ plan: ImportPlan }>()

function countText(create: number, update: number): string {
  if (create === 0 && update === 0) return '无'
  const parts: string[] = []
  if (create > 0) parts.push(`新增 ${create}`)
  if (update > 0) parts.push(`更新 ${update}`)
  return parts.join(' · ')
}
</script>

<template>
  <div class="pack-preview">
    <div class="preview-summary">
      <div class="preview-stat">
        <span class="preview-stat-label">想法</span>
        <span>{{ countText(plan.counts.ideas.create, plan.counts.ideas.update) }}</span>
      </div>
      <div class="preview-stat">
        <span class="preview-stat-label">目标</span>
        <span>{{ countText(plan.counts.goals.create, plan.counts.goals.update) }}</span>
      </div>
      <div class="preview-stat">
        <span class="preview-stat-label">里程碑</span>
        <span>{{ countText(plan.counts.milestones.create, plan.counts.milestones.update) }}</span>
      </div>
      <div class="preview-stat">
        <span class="preview-stat-label">任务</span>
        <span>{{ countText(plan.counts.tasks.create, plan.counts.tasks.update) }}</span>
      </div>
      <div class="preview-stat">
        <span class="preview-stat-label">周期</span>
        <span>{{ countText(plan.counts.cycles.create, plan.counts.cycles.update) }}</span>
      </div>
    </div>

    <n-alert v-for="warning in plan.warnings" :key="warning" type="warning" :bordered="false" class="preview-alert">
      {{ warning }}
    </n-alert>

    <n-alert v-if="plan.pack.assumptions.length > 0" type="info" :bordered="false" class="preview-alert">
      <p class="preview-alert-title">AI 假设</p>
      <ul>
        <li v-for="assumption in plan.pack.assumptions" :key="assumption">{{ assumption }}</li>
      </ul>
    </n-alert>

    <section v-if="plan.pack.ideas.length > 0" class="preview-section">
      <h4>想法</h4>
      <ul class="preview-list">
        <li v-for="idea in plan.pack.ideas" :key="idea.externalId">
          <span>{{ idea.title }}</span>
          <n-tag size="tiny" :bordered="false">{{ idea.status }}</n-tag>
        </li>
      </ul>
    </section>

    <section v-for="goal in plan.pack.goals" :key="goal.externalId" class="preview-section">
      <h4>
        {{ goal.title }}
        <n-tag size="tiny" :bordered="false">P{{ goal.priority }}</n-tag>
      </h4>
      <p v-if="goal.why" class="preview-muted">{{ goal.why }}</p>
      <div v-for="milestone in goal.milestones" :key="milestone.externalId" class="preview-milestone">
        <p class="preview-milestone-title">{{ milestone.title }}</p>
        <p class="preview-muted">验收：{{ milestone.acceptance }}</p>
        <ul class="preview-list">
          <li v-for="task in milestone.tasks" :key="task.externalId">
            <span>{{ task.title }}</span>
            <n-tag size="tiny" :bordered="false">{{ task.estimate }}</n-tag>
          </li>
        </ul>
      </div>
    </section>

    <section v-if="plan.pack.cycles.length > 0" class="preview-section">
      <h4>周期</h4>
      <ul class="preview-list">
        <li v-for="cycle in plan.pack.cycles" :key="cycle.externalId">
          <span>{{ cycle.label }}（{{ cycle.startDate }} → {{ cycle.endDate }}）</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.pack-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: 55vh;
  overflow-y: auto;
  padding-right: var(--space-1);
}

.preview-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-2);
}

.preview-stat {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--text-sm);
}

.preview-stat-label {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.preview-section {
  border-top: 1px solid var(--app-border-soft);
  padding-top: var(--space-2);
}

.preview-section h4 {
  font-size: var(--text-md);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.preview-muted {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.preview-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--text-sm);
}

.preview-list li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.preview-milestone {
  margin-left: var(--space-3);
  margin-top: var(--space-2);
  border-left: 2px solid var(--app-border-soft);
  padding-left: var(--space-3);
}

.preview-milestone-title {
  font-size: var(--text-sm);
  font-weight: 600;
}

.preview-alert-title {
  font-weight: 600;
  margin-bottom: 2px;
}

.preview-alert ul {
  margin: 0;
  padding-left: 18px;
  font-size: var(--text-sm);
}
</style>
