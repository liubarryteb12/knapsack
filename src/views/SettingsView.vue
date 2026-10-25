<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NSwitch, NInput, NButton, NCard, NForm, NFormItem, NSelect, NRadioGroup, NRadioButton, useMessage } from 'naive-ui'
import { useTripsStore } from '../stores/trips'
import { loadAiConfigWithKey, saveAiConfig, testAiConnection, fetchModelList, type AiConfig } from '../utils/aiConfig'
import { useThemeStore, type ThemeMode } from '../stores/theme'
import UiPageHeader from '../components/ui/UiPageHeader.vue'
import { MOD_MANIFESTS, modState, setModEnabled } from '../core/modRegistry'
import { usePagedList } from '../composables/usePagedList'

const tripsStore = useTripsStore()
const themeStore = useThemeStore()

function setTheme(value: ThemeMode) {
  themeStore.setMode(value)
}

onMounted(() => {
  tripsStore.loadSummaries()
})

// ---- 模块开关：按旅行逐个配置 ----
async function toggleModule(tripId: string, key: 'expenses' | 'notes', value: boolean) {
  if (!(await tripsStore.setTripModule(tripId, key, value))) {
    message.error('保存失败，开关已还原')
  }
}

// ---- AI 配置 ----
const ai = ref<AiConfig>({ baseURL: '', apiKey: '', model: '' })
const testing = ref(false)
const testResult = ref('')
const testOk = ref(false)
const message = useMessage()

/** 内置候选模型；从接口拉到真实列表后会与之合并 */
const BUILTIN_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
  'gpt-4o-mini',
  'gpt-4o',
  'qwen-plus',
  'glm-4-flash',
]

const modelOptions = ref(BUILTIN_MODELS.map((m) => ({ label: m, value: m })))
const fetchingModels = ref(false)

/** 只有用户点击后才访问外部 /models，不在打开设置页时后台联网。 */
async function fetchModels() {
  if (!ai.value.baseURL || !ai.value.apiKey) {
    message.warning('请先填写 Base URL 与 API Key')
    return
  }
  persistAi()
  fetchingModels.value = true
  const result = await fetchModelList(ai.value)
  fetchingModels.value = false
  if (!result.ok) {
    message.error(`获取模型列表失败：${result.message}`)
    return
  }
  const merged = [...modelOptions.value]
  const known = new Set(merged.map((o) => o.value))
  for (const id of result.models) {
    if (!known.has(id)) {
      merged.push({ label: id, value: id })
      known.add(id)
    }
  }
  modelOptions.value = merged
  message.success(result.message)
}

onMounted(async () => {
  ai.value = await loadAiConfigWithKey()
})

function persistAi() {
  void saveAiConfig(ai.value)
}

async function runTest() {
  persistAi()
  testing.value = true
  testResult.value = ''
  const result = await testAiConnection(ai.value)
  testing.value = false
  testResult.value = result.message
  testOk.value = result.ok
}

const hasTrips = computed(() => tripsStore.summaries.length > 0)
const {
  page,
  pageCount,
  pageItems: tripPage,
  previous,
  next,
} = usePagedList(computed(() => tripsStore.summaries), 20)
</script>

<template>
  <div class="page">
    <UiPageHeader title="设置" subtitle="主题、模块与 AI 接口都只保存在本机" />

    <n-card size="small" class="section" title="外观">
      <div class="appearance-row">
        <n-radio-group :value="themeStore.mode" size="small" @update:value="setTheme">
          <n-radio-button value="light">浅色</n-radio-button>
          <n-radio-button value="dark">深色</n-radio-button>
          <n-radio-button value="system">跟随系统</n-radio-button>
        </n-radio-group>
      </div>
    </n-card>

    <n-card size="small" class="section" title="模块">
      <p class="muted small">关闭模块只隐藏入口，不会删除本机数据。</p>
      <div v-for="mod in MOD_MANIFESTS" :key="mod.id" class="mod-row">
        <div class="mod-copy">
          <strong>{{ mod.name }}</strong>
          <span class="muted small">{{ mod.description }}</span>
        </div>
        <n-switch :value="modState[mod.id]" size="small" @update:value="(v: boolean) => setModEnabled(mod.id, v)" />
      </div>
    </n-card>

    <n-card size="small" class="section" title="模块开关（按旅行）">
      <p v-if="!hasTrips" class="muted small">还没有旅行计划。开关在各旅行的设置里控制预算/备忘模块的显隐。</p>
      <div v-for="trip in tripPage" :key="trip.id" class="module-row">
        <strong class="trip-name">{{ trip.name }}</strong>
        <label class="switch-label">
          预算
          <n-switch :value="trip.enabledModules.expenses" size="small" @update:value="(v: boolean) => toggleModule(trip.id, 'expenses', v)" />
        </label>
        <label class="switch-label">
          备忘
          <n-switch :value="trip.enabledModules.notes" size="small" @update:value="(v: boolean) => toggleModule(trip.id, 'notes', v)" />
        </label>
      </div>
      <div v-if="pageCount > 1" class="pagination">
        <n-button size="small" :disabled="page <= 1" @click="previous">上一页</n-button>
        <span class="muted small">第 {{ page }} / {{ pageCount }} 页</span>
        <n-button size="small" :disabled="page >= pageCount" @click="next">下一页</n-button>
      </div>
    </n-card>

    <n-card size="small" class="section">
      <template #header>
        <div class="card-head-with-status">
          AI 接口配置
          <span v-if="testOk" class="status-dot ok" title="连接正常" />
        </div>
      </template>
      <p class="muted small">
        仅支持 OpenAI 兼容接口（如 DeepSeek）。配置加密保存在本机，不上传任何服务器。
      </p>
      <n-form label-placement="left" label-width="90">
        <n-form-item label="Base URL">
          <n-input v-model:value="ai.baseURL" placeholder="https://api.deepseek.com/v1" @blur="persistAi" />
        </n-form-item>
        <n-form-item label="API Key">
          <n-input
            v-model:value="ai.apiKey"
            type="password"
            show-password-on="click"
            placeholder="sk-..."
            @blur="persistAi"
          />
        </n-form-item>
        <n-form-item label="模型名">
          <div class="model-row">
            <n-select
              v-model:value="ai.model"
              :options="modelOptions"
              filterable
              tag
              placeholder="选择或直接输入模型名"
              @update:value="persistAi"
            />
            <n-button size="small" :loading="fetchingModels" @click="fetchModels">获取列表</n-button>
          </div>
        </n-form-item>
      </n-form>
      <div class="test-row">
        <n-button size="small" :loading="testing" @click="runTest">测试连接</n-button>
        <span v-if="testResult" class="test-result" :class="{ ok: testOk }">{{ testResult }}</span>
      </div>
    </n-card>

    <n-card size="small" class="section" title="关于">
      <p class="muted small">
        行囊 Knapsack · 本地优先的模块化个人生活系统。数据 100% 存本地，无账号、无服务器、无遥测。
      </p>
    </n-card>
  </div>
</template>

<style scoped>
.section {
  margin-bottom: var(--space-4);
}

.card-head-with-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.ok {
  background: var(--app-success);
  box-shadow: 0 0 0 3px var(--app-success-soft);
}

.module-row {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: 6px 0;
}

.mod-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 8px 0;
  border-bottom: 1px solid var(--app-border);
}

.mod-row:last-child {
  border-bottom: 0;
}

.mod-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mod-copy .small {
  margin-bottom: 0;
}

.trip-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding-top: var(--space-3);
}

.switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--app-muted);
}

.appearance-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.model-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
}

.model-row :deep(.n-select) {
  flex: 1;
  min-width: 0;
}

.test-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.test-result {
  font-size: var(--text-sm);
  color: var(--app-danger);
}

.test-result.ok {
  color: var(--app-success);
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: var(--text-xs);
  margin-bottom: 10px;
}
</style>
