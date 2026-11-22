<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NModal, NTag, useMessage } from 'naive-ui'
import PackPreview from './PackPreview.vue'
import {
  AiDecomposeError,
  PROMPT_VERSION,
  askClarifications,
  decompose,
} from '../services/aiDecompose'
import {
  buildImportPlan,
  commitImport,
  findPreviousImport,
  loadLocalSnapshot,
  type ImportPlan,
  type ImportRecord,
} from '../services/parseGoalPack'
import { loadAiConfigWithKey } from '../../../utils/aiConfig'
import { useGoalsStore } from '../store'
import type { Idea } from '../schema'
import type { ClarificationQuestion } from '../prompts'

const props = defineProps<{
  show: boolean
  idea?: Idea | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  imported: [plan: ImportPlan]
}>()

const store = useGoalsStore()
const message = useMessage()

const DRAFT_KEY = 'knapsack.goals.ai-draft.v1'

const visible = computed({
  get: () => props.show,
  set: (value: boolean) => emit('update:show', value),
})

const step = ref<'input' | 'asking' | 'preview'>('input')
const ideaText = ref('')
const questions = ref<ClarificationQuestion[]>([])
const answers = reactive<Record<string, string>>({})
const unknown = reactive<Record<string, boolean>>({})
const plan = ref<ImportPlan | null>(null)
const previous = ref<ImportRecord | null>(null)
const force = ref(false)
const error = ref('')
const busy = ref(false)
const busyLabel = ref('')
const noKey = ref(false)
let controller: AbortController | null = null

watch(
  () => props.show,
  async (show) => {
    if (!show) {
      controller?.abort()
      return
    }
    reset()
    const config = await loadAiConfigWithKey()
    noKey.value = !config.apiKey
    const idea = props.idea
    if (idea) ideaText.value = idea.raw ? `${idea.title}\n\n${idea.raw}` : idea.title
    restoreDraft()
  },
)

function reset() {
  step.value = 'input'
  questions.value = []
  plan.value = null
  previous.value = null
  force.value = false
  error.value = ''
  busy.value = false
  busyLabel.value = ''
  Object.keys(answers).forEach((key) => delete answers[key])
  Object.keys(unknown).forEach((key) => delete unknown[key])
}

function saveDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        ideaText: ideaText.value,
        questions: questions.value,
        answers: { ...answers },
        unknown: { ...unknown },
      }),
    )
  } catch {
    /* 草稿保存失败不影响主流程 */
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return
    const draft = JSON.parse(raw) as {
      ideaText?: string
      questions?: ClarificationQuestion[]
      answers?: Record<string, string>
      unknown?: Record<string, boolean>
    }
    if (!ideaText.value && draft.ideaText) ideaText.value = draft.ideaText
    if (draft.questions?.length) {
      questions.value = draft.questions
      Object.assign(answers, draft.answers ?? {})
      Object.assign(unknown, draft.unknown ?? {})
      step.value = 'asking'
    }
  } catch {
    /* 损坏的草稿直接忽略 */
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

function messageOf(err: unknown): string {
  return err instanceof AiDecomposeError || err instanceof Error ? err.message : String(err)
}

async function startAsking() {
  const text = ideaText.value.trim()
  if (!text) {
    message.warning('先写一段想法')
    return
  }
  const config = await loadAiConfigWithKey()
  if (!config.apiKey) {
    noKey.value = true
    return
  }
  const ctrl = new AbortController()
  controller = ctrl
  busy.value = true
  busyLabel.value = '正在生成澄清问题…'
  error.value = ''
  try {
    questions.value = await askClarifications(config, text, ctrl.signal)
    step.value = 'asking'
    saveDraft()
  } catch (err) {
    if (!ctrl.signal.aborted) error.value = messageOf(err)
  } finally {
    busy.value = false
    controller = null
  }
}

async function generate() {
  const config = await loadAiConfigWithKey()
  if (!config.apiKey) {
    noKey.value = true
    return
  }
  const qa = questions.value.map((question) => ({
    question: question.question,
    answer: unknown[question.id] ? null : (answers[question.id] ?? '').trim() || null,
  }))

  const ctrl = new AbortController()
  controller = ctrl
  busy.value = true
  busyLabel.value = '正在拆解为四层结构，约需半分钟…'
  error.value = ''
  try {
    const { pack } = await decompose(config, ideaText.value.trim(), qa, ctrl.signal)
    const local = await loadLocalSnapshot()
    plan.value = await buildImportPlan(pack, local)
    previous.value = (await findPreviousImport(plan.value.idempotencyKey)) ?? null
    step.value = 'preview'
  } catch (err) {
    if (!ctrl.signal.aborted) error.value = messageOf(err)
  } finally {
    busy.value = false
    controller = null
  }
}

async function confirmImport() {
  if (!plan.value) return
  if (previous.value && !force.value) {
    force.value = true
    return
  }
  busy.value = true
  try {
    await commitImport(plan.value, { promptVersion: PROMPT_VERSION })
    await store.loadAll()
    if (props.idea) {
      const matchedIdea = plan.value.pack.ideas.find((item) => item.title === props.idea?.title)
      const goalExternalId = matchedIdea?.goalExternalId ?? plan.value.pack.goals[0]?.externalId
      const goal = plan.value.goals.find((item) => item.externalId === goalExternalId)
      await store.updateIdea(props.idea.id, { status: 'clarified', goalId: goal?.id })
    }
    clearDraft()
    message.success('拆解结果已入库')
    emit('imported', plan.value)
    visible.value = false
  } catch (err) {
    error.value = messageOf(err)
  } finally {
    busy.value = false
  }
}

function cancel() {
  controller?.abort()
  controller = null
  busy.value = false
  visible.value = false
}

const layerLabel: Record<ClarificationQuestion['layer'], string> = {
  goal: '目标',
  milestone: '里程碑',
  task: '任务',
  cycle: '任务',
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="AI 拆解" style="max-width: 720px">
    <div class="wizard-body">
      <n-alert v-if="noKey" type="warning" :bordered="false">
        还没有配置 AI 接口。请到「设置」里填写 Base URL、模型和 API Key，再回来使用。
      </n-alert>

      <n-alert v-if="error" type="error" :bordered="false" class="wizard-error">{{ error }}</n-alert>

      <template v-if="step === 'input'">
        <p class="wizard-hint">
          写清楚现状、想要的结果和已知约束。AI 会先问 3–5 个澄清问题，再拆成目标、里程碑与可分层级的任务。
        </p>
        <n-input
          v-model:value="ideaText"
          type="textarea"
          placeholder="例如：想把公众号稳定更新起来，但经常写完没人看，也不知道选题从哪来…"
          :autosize="{ minRows: 6, maxRows: 14 }"
          :disabled="busy"
        />
      </template>

      <template v-else-if="step === 'asking'">
        <p class="wizard-hint">回答能回答的；不确定的勾选「不知道」，AI 会把它写进假设。</p>
        <div v-for="question in questions" :key="question.id" class="wizard-question">
          <div class="wizard-question-head">
            <span class="wizard-question-text">{{ question.question }}</span>
            <n-tag size="tiny" :bordered="false">{{ layerLabel[question.layer] }}</n-tag>
          </div>
          <p v-if="question.why" class="wizard-question-why">{{ question.why }}</p>
          <n-input
            v-model:value="answers[question.id]"
            size="small"
            placeholder="一两句话即可"
            :disabled="unknown[question.id] || busy"
          />
          <n-checkbox v-model:checked="unknown[question.id]" size="small">不知道，让 AI 假设</n-checkbox>
        </div>
      </template>

      <template v-else-if="step === 'preview' && plan">
        <n-alert v-if="previous" type="warning" :bordered="false">
          该包已于 {{ new Date(previous.importedAt).toLocaleString('zh-CN') }} 导入过。
          {{ force ? '再次确认将更新内容字段，不会覆盖本地状态。' : '如仍要导入，请再点一次确认。' }}
        </n-alert>
        <PackPreview :plan="plan" />
      </template>

      <p v-if="busy" class="wizard-busy">{{ busyLabel }}</p>
    </div>

    <template #footer>
      <div class="wizard-footer">
        <n-button @click="cancel">{{ busy ? '取消请求' : '关闭' }}</n-button>

        <template v-if="step === 'input'">
          <n-button type="primary" :loading="busy" :disabled="noKey || !ideaText.trim()" @click="startAsking">
            开始提问
          </n-button>
        </template>

        <template v-else-if="step === 'asking'">
          <n-button @click="step = 'input'">上一步</n-button>
          <n-button type="primary" :loading="busy" @click="generate">生成四层拆解</n-button>
        </template>

        <template v-else-if="step === 'preview' && plan">
          <n-button @click="step = 'asking'">重新生成</n-button>
          <n-button type="primary" :loading="busy" @click="confirmImport">
            {{ previous && !force ? '仍然导入' : '确认导入' }}
          </n-button>
        </template>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.wizard-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.wizard-hint {
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.wizard-error {
  white-space: pre-wrap;
}

.wizard-question {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.wizard-question-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}

.wizard-question-text {
  font-size: var(--text-sm);
  font-weight: 600;
}

.wizard-question-why {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.wizard-busy {
  color: var(--app-accent);
  font-size: var(--text-sm);
}

.wizard-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
