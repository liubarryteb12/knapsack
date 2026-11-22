<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { Plus, Download, Sparkles, Target, Upload } from '@lucide/vue'
import Sortable from 'sortablejs'
import UiEmptyState from '../../components/ui/UiEmptyState.vue'
import UiPageHeader from '../../components/ui/UiPageHeader.vue'
import { modRegistry } from '../../core/bootMods'
import { db } from '../../db'
import { useGoalsStore } from './store'
import type { Idea } from './schema'
import {
  buildWorkspaceSnapshot,
  readPromptProjection,
  readSnapshotTables,
  serializeSnapshot,
} from './services/workspaceSnapshot'
import { saveSnapshotFile, snapshotFilename } from './services/snapshotFile'
import AiWizardModal from './components/AiWizardModal.vue'
import ImportPackModal from './components/ImportPackModal.vue'
import GoalCard from './components/GoalCard.vue'
import IdeaPool from './components/IdeaPool.vue'
import MindMapView from './components/MindMapView.vue'

const store = useGoalsStore()
const router = useRouter()
const message = useMessage()

const activeTab = ref<'goals' | 'mindmap' | 'ideas'>('goals')
/** 从目标卡片「导图」入口跳转时锁定的目标 */
const mindmapGoalId = ref('')

/** 打开某目标的思维导图：切到导图栏目并聚焦该目标 */
function openMindmap(goalId: string) {
  mindmapGoalId.value = goalId
  activeTab.value = 'mindmap'
}
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

onMounted(async () => {
  try {
    if (!store.loaded) await store.loadAll()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
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

const exporting = ref(false)

/** 手动导出工作区快照（BOARD_MODULE_SPEC §12.2）：供外部 agent 经 MCP 读取 */
async function exportSnapshot() {
  exporting.value = true
  try {
    const [tables, prompts] = await Promise.all([
      readSnapshotTables(db),
      readPromptProjection(modRegistry.capabilities),
    ])
    const snapshot = buildWorkspaceSnapshot(tables, prompts)
    const result = await saveSnapshotFile(serializeSnapshot(snapshot))
    if (result.cancelled) message.info('已取消导出')
    else if (result.path) message.success(`快照已导出：${result.path}`)
    else if (result.warning) message.warning(`快照已保存（分享未完成：${result.warning}）`)
    else message.success(`快照已导出：${snapshotFilename()}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    exporting.value = false
  }
}

// ---------- 目标卡片拖拽排序 ----------

const goalGrid = ref<HTMLElement | null>(null)
let goalSortable: Sortable | null = null

function destroyGoalSortable() {
  goalSortable?.destroy()
  goalSortable = null
}

function setupGoalSortable() {
  destroyGoalSortable()
  if (!goalGrid.value) return
  goalSortable = Sortable.create(goalGrid.value, {
    animation: 150,
    handle: '.goal-card-drag',
    draggable: '.goal-card',
    ghostClass: 'drag-ghost',
    onEnd(evt) {
      // 数据模型是唯一事实源：先还原 DOM，再交给 Vue 重渲染
      const from = evt.oldIndex ?? -1
      const parent = evt.from as HTMLElement
      if (from >= 0 && evt.oldIndex !== evt.newIndex) {
        parent.insertBefore(evt.item as HTMLElement, parent.children[from] ?? null)
      }
      const to = evt.newIndex ?? -1
      if (from < 0 || to < 0 || from === to) return
      const ids = store.goalsSorted.map((goal) => goal.id)
      const [moved] = ids.splice(from, 1)
      if (moved === undefined) return
      ids.splice(to, 0, moved)
      void store.reorderGoals(ids)
    },
  })
}

const goalOrderSignature = computed(() => store.goalsSorted.map((goal) => goal.id).join(','))

watch(
  [goalOrderSignature, activeTab],
  () => {
    if (activeTab.value === 'goals') nextTick(setupGoalSortable)
    else destroyGoalSortable()
  },
  { immediate: true },
)

onBeforeUnmount(destroyGoalSortable)
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
      <n-button :loading="exporting" @click="exportSnapshot">
        <template #icon><Download :size="16" /></template>
        导出快照
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

        <div v-else ref="goalGrid" class="goal-grid">
          <GoalCard
            v-for="goal in store.goalsSorted"
            :key="goal.id"
            :goal="goal"
            :progress="store.goalProgress(goal.id)"
            :milestone-count="store.milestonesOf(goal.id).length"
            :task-count="store.milestonesOf(goal.id).reduce((sum, m) => sum + store.tasksOf(m.id).length, 0)"
            @open="open(goal.id)"
            @mindmap="openMindmap(goal.id)"
          />
        </div>
      </n-tab-pane>

      <n-tab-pane name="mindmap" tab="思维导图">
        <MindMapView :initial-goal-id="mindmapGoalId" @goal-change="mindmapGoalId = $event" />
      </n-tab-pane>

      <n-tab-pane name="ideas" tab="想法池">
        <IdeaPool @promoted="onPromoted" @ai="onAi" />
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

:deep(.drag-ghost) {
  opacity: 0.4;
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
