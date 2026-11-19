<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NInput,
  NModal,
  NSelect,
  NTabPane,
  NTabs,
  useMessage,
} from 'naive-ui'
import { Plus, Sparkles, Target, Upload } from '@lucide/vue'
import UiEmptyState from '../../components/ui/UiEmptyState.vue'
import UiPageHeader from '../../components/ui/UiPageHeader.vue'
import { useGoalsStore } from './store'
import type { Idea } from './schema'
import CycleBoard from './components/CycleBoard.vue'
import BoardView from './components/BoardView.vue'
import AiWizardModal from './components/AiWizardModal.vue'
import ImportPackModal from './components/ImportPackModal.vue'
import GoalCard from './components/GoalCard.vue'
import IdeaPool from './components/IdeaPool.vue'

const store = useGoalsStore()
const router = useRouter()
const message = useMessage()

const activeTab = ref<'goals' | 'ideas' | 'cycles' | 'board'>('goals')
const showCreate = ref(false)
const showImport = ref(false)
const showAi = ref(false)
const aiIdea = ref<Idea | null>(null)
const creating = ref(false)
const form = ref({
  title: '',
  why: '',
  successCriteria: '',
  startDate: '',
  targetDate: '',
  priority: 2 as 1 | 2 | 3,
})

const priorityOptions = [
  { label: 'P1 最高', value: 1 },
  { label: 'P2 常规', value: 2 },
  { label: 'P3 有空再说', value: 3 },
]

const cycleGoalId = ref('')
const cycleGoalOptions = computed(() =>
  store.goalsSorted.map((goal) => ({ label: goal.title, value: goal.id })),
)

onMounted(async () => {
  try {
    if (!store.loaded) await store.loadAll()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
  cycleGoalId.value ||= store.goalsSorted[0]?.id ?? ''
})

function open(goalId: string) {
  void router.push(`/goals/${goalId}`)
}

async function createGoal() {
  const title = form.value.title.trim()
  if (!title) {
    message.warning('先写目标标题')
    return
  }
  creating.value = true
  try {
    const goal = await store.createGoal({
      title,
      why: form.value.why.trim(),
      successCriteria: form.value.successCriteria.trim(),
      startDate: form.value.startDate || undefined,
      targetDate: form.value.targetDate || undefined,
      priority: form.value.priority,
    })
    showCreate.value = false
    form.value = {
      title: '',
      why: '',
      successCriteria: '',
      startDate: '',
      targetDate: '',
      priority: 2,
    }
    message.success('目标已创建')
    open(goal.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    creating.value = false
  }
}

function onPromoted(goalId: string) {
  open(goalId)
}

function onAi(idea: Idea) {
  aiIdea.value = idea
  showAi.value = true
}

function onAiImported() {
  const firstGoal = store.goalsSorted[0]
  if (firstGoal) open(firstGoal.id)
}

async function sendToBoard(goalId: string) {
  try {
    await store.updateGoal(goalId, { status: 'active' })
    message.success('已送入看板')
    activeTab.value = 'board'
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <section>
    <UiPageHeader title="目标" subtitle="把想法变成可验证的阶段，再拆到今天能做的动作">
      <n-button @click="aiIdea = null; showAi = true">
        <template #icon><Sparkles :size="16" /></template>
        AI 拆解
      </n-button>
      <n-button @click="showImport = true">
        <template #icon><Upload :size="16" /></template>
        导入 goal-pack
      </n-button>
      <n-button type="primary" @click="showCreate = true">
        <template #icon><Plus :size="16" /></template>
        新建目标
      </n-button>
    </UiPageHeader>

    <n-tabs v-model:value="activeTab" type="segment" animated>
      <n-tab-pane name="goals" tab="目标树">
        <UiEmptyState
          v-if="store.goalsSorted.length === 0"
          :icon="Target"
          title="还没有目标"
          description="可以在想法池里记录一个模糊想法，晋级成目标，再拆成里程碑与任务。"
        >
          <n-button @click="activeTab = 'ideas'">去记录想法</n-button>
          <n-button type="primary" @click="showCreate = true">直接新建目标</n-button>
        </UiEmptyState>

        <div v-else class="goal-grid">
          <GoalCard
            v-for="goal in store.goalsSorted"
            :key="goal.id"
            :goal="goal"
            :progress="store.goalProgress(goal.id)"
            :milestone-count="store.milestonesOf(goal.id).length"
            :task-count="store.milestonesOf(goal.id).reduce((sum, m) => sum + store.tasksOf(m.id).length, 0)"
            @open="open(goal.id)"
            @send-to-board="sendToBoard(goal.id)"
          />
        </div>
      </n-tab-pane>

      <n-tab-pane name="ideas" tab="想法池">
        <IdeaPool @promoted="onPromoted" @ai="onAi" />
      </n-tab-pane>

      <n-tab-pane name="cycles" tab="周期">
        <div v-if="store.goalsSorted.length === 0" class="cycle-hint">先创建至少一个目标，才能安排周期。</div>
        <template v-else>
          <div class="cycle-picker">
            <span>选择目标</span>
            <n-select v-model:value="cycleGoalId" :options="cycleGoalOptions" style="max-width: 320px" />
          </div>
          <CycleBoard v-if="cycleGoalId" :goal-id="cycleGoalId" />
        </template>
      </n-tab-pane>

      <n-tab-pane name="board" tab="看板">
        <BoardView @go-create="showCreate = true" />
      </n-tab-pane>
    </n-tabs>

    <n-modal v-model:show="showCreate" preset="card" title="新建目标" style="max-width: 520px">
      <div class="create-form">
        <n-input v-model:value="form.title" placeholder="目标标题，例如：连续 8 周每周产出 1 篇" />
        <n-input v-model:value="form.why" placeholder="为什么做（一句话）" />
        <n-input
          v-model:value="form.successCriteria"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          placeholder="成功标准：怎样算完成"
        />
        <div class="create-row">
          <label>
            <span>开始</span>
            <input v-model="form.startDate" class="date-input" type="date" />
          </label>
          <label>
            <span>截止</span>
            <input v-model="form.targetDate" class="date-input" type="date" />
          </label>
          <label>
            <span>优先级</span>
            <n-select v-model:value="form.priority" :options="priorityOptions" style="width: 130px" />
          </label>
        </div>
      </div>
      <template #footer>
        <div class="create-footer">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="createGoal">创建并打开</n-button>
        </div>
      </template>
    </n-modal>

    <ImportPackModal v-model:show="showImport" />
    <AiWizardModal v-model:show="showAi" :idea="aiIdea" @imported="onAiImported" />
  </section>
</template>

<style scoped>
.goal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.cycle-hint {
  color: var(--app-muted);
  font-size: var(--text-sm);
  padding: var(--space-4) 0;
}

.cycle-picker {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  font-size: var(--text-sm);
  color: var(--app-muted);
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.create-row {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.create-row label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--app-muted);
}

.date-input {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  background: var(--app-bg-soft);
  color: var(--app-text);
  padding: 4px 8px;
  font-size: var(--text-sm);
}

.create-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
