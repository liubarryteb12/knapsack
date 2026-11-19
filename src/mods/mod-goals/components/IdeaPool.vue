<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NPopconfirm, NSelect, NTag, useMessage } from 'naive-ui'
import { ArrowUpRight, Lightbulb, Plus, Sparkles } from '@lucide/vue'
import UiEmptyState from '../../../components/ui/UiEmptyState.vue'
import { useGoalsStore } from '../store'
import type { Idea, IdeaStatus } from '../schema'

const emit = defineEmits<{ promoted: [goalId: string]; ai: [idea: Idea] }>()

const store = useGoalsStore()
const message = useMessage()

const STATUS_LABEL: Record<IdeaStatus, string> = {
  raw: '原始',
  clarified: '已澄清',
  promoted: '已成目标',
  parked: '已搁置',
}

const filter = ref<'all' | IdeaStatus>('all')
const title = ref('')
const raw = ref('')
const saving = ref(false)

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '原始', value: 'raw' },
  { label: '已澄清', value: 'clarified' },
  { label: '已成目标', value: 'promoted' },
  { label: '已搁置', value: 'parked' },
]

const visibleIdeas = computed(() => {
  const list = store.activeIdeas
  return filter.value === 'all' ? list : list.filter((idea) => idea.status === filter.value)
})

async function create() {
  const value = title.value.trim()
  if (!value) {
    message.warning('先写一句想法')
    return
  }
  saving.value = true
  try {
    await store.createIdea({ title: value, raw: raw.value.trim() })
    title.value = ''
    raw.value = ''
    message.success('已记录想法')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}

async function clarify(idea: Idea) {
  const next = idea.status === 'clarified' ? 'raw' : 'clarified'
  await store.setIdeaStatus(idea.id, next)
}

async function promote(idea: Idea) {
  try {
    const goal = await store.promoteIdea(idea.id)
    message.success('已晋级为目标')
    emit('promoted', goal.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function remove(idea: Idea) {
  await store.deleteIdea(idea.id)
  message.success('已删除')
}
</script>

<template>
  <div class="idea-pool">
    <n-input
      v-model:value="title"
      placeholder="记一句想法，例如：把公众号选题做成可复用模板"
      :maxlength="120"
      @keyup.enter="create"
    />
    <n-input
      v-model:value="raw"
      type="textarea"
      placeholder="补充背景、约束或讨论纪要（可留空）"
      :autosize="{ minRows: 2, maxRows: 5 }"
    />
    <div class="idea-pool-actions">
      <n-select v-model:value="filter" :options="filterOptions" size="small" style="width: 120px" />
      <n-button type="primary" :loading="saving" @click="create">
        <template #icon><Plus :size="16" /></template>
        记录想法
      </n-button>
    </div>

    <UiEmptyState
      v-if="visibleIdeas.length === 0"
      :icon="Lightbulb"
      title="还没有想法"
      description="把还没想清楚的东西先放进来，澄清后再晋级为目标。"
    />

    <ul v-else class="idea-list">
      <li v-for="idea in visibleIdeas" :key="idea.id" class="idea-item">
        <div class="idea-item-head">
          <h4>{{ idea.title }}</h4>
          <n-tag size="small" :bordered="false">{{ STATUS_LABEL[idea.status] }}</n-tag>
        </div>
        <p v-if="idea.raw" class="idea-item-raw">{{ idea.raw }}</p>
        <div>
          <n-tag v-for="tag in idea.tags" :key="tag" size="tiny" :bordered="false">{{ tag }}</n-tag>
        </div>
        <div class="idea-item-actions">
          <n-button size="tiny" quaternary @click="clarify(idea)">
            {{ idea.status === 'clarified' ? '退回原始' : '标记已澄清' }}
          </n-button>
          <n-button v-if="idea.status !== 'promoted'" size="tiny" @click="emit('ai', idea)">
            <template #icon><Sparkles :size="14" /></template>
            AI 拆解
          </n-button>
          <n-button
            v-if="idea.status !== 'promoted'"
            size="tiny"
            type="primary"
            @click="promote(idea)"
          >
            <template #icon><ArrowUpRight :size="14" /></template>
            晋级为目标
          </n-button>
          <n-button
            v-if="idea.status !== 'promoted'"
            size="tiny"
            quaternary
            @click="store.setIdeaStatus(idea.id, idea.status === 'parked' ? 'raw' : 'parked')"
          >
            {{ idea.status === 'parked' ? '恢复' : '搁置' }}
          </n-button>
          <n-popconfirm @positive-click="remove(idea)">
            <template #trigger>
              <n-button size="tiny" quaternary type="error">删除</n-button>
            </template>
            删除后无法恢复，确定吗？
          </n-popconfirm>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.idea-pool {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.idea-pool-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.idea-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.idea-item {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  background: var(--app-card-bg);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.idea-item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.idea-item-head h4 {
  font-size: var(--text-md);
  font-weight: 600;
}

.idea-item-raw {
  color: var(--app-muted);
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

.idea-item-actions {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
}
</style>
