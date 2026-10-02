<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NSwitch, NInput, NButton, NCard, NForm, NFormItem, NSelect, NRadioGroup, NRadioButton } from 'naive-ui'
import { useTripsStore } from '../stores/trips'
import type { Trip } from '../schema/trip'
import { loadAiConfig, saveAiConfig, testAiConnection, type AiConfig } from '../utils/aiConfig'
import { useThemeStore, type ThemeMode } from '../stores/theme'

const tripsStore = useTripsStore()
const themeStore = useThemeStore()

function setTheme(value: ThemeMode) {
  themeStore.setMode(value)
}

onMounted(() => {
  tripsStore.load()
})

// ---- 模块开关：按旅行逐个配置 ----
function toggleModule(trip: Trip, key: 'expenses' | 'notes', value: boolean) {
  trip.enabledModules[key] = value
  tripsStore.saveTrip(trip)
}

// ---- AI 配置 ----
const ai = ref<AiConfig>({ baseURL: '', apiKey: '', model: '' })
const testing = ref(false)
const testResult = ref('')

onMounted(() => {
  ai.value = loadAiConfig()
})

const modelOptions = [
  'deepseek-chat',
  'deepseek-reasoner',
  'gpt-4o-mini',
  'gpt-4o',
  'qwen-plus',
  'glm-4-flash',
].map((m) => ({ label: m, value: m }))

function persistAi() {
  saveAiConfig(ai.value)
}

async function runTest() {
  persistAi()
  testing.value = true
  testResult.value = ''
  const result = await testAiConnection(ai.value)
  testing.value = false
  testResult.value = result.message
}

const hasTrips = computed(() => tripsStore.trips.length > 0)
</script>

<template>
  <div class="page">
    <h1>设置</h1>

    <n-card size="small" class="section" title="外观">
      <div class="appearance-row">
        <n-radio-group :value="themeStore.mode" size="small" @update:value="setTheme">
          <n-radio-button value="light">浅色</n-radio-button>
          <n-radio-button value="dark">深色</n-radio-button>
          <n-radio-button value="system">跟随系统</n-radio-button>
        </n-radio-group>
        <p class="muted small">设置只保存在本机。</p>
      </div>
    </n-card>

    <n-card size="small" class="section" title="模块开关（按旅行）">
      <p v-if="!hasTrips" class="muted small">还没有旅行计划。开关在各旅行的设置里控制预算/备忘模块的显隐。</p>
      <div v-for="trip in tripsStore.trips" :key="trip.id" class="module-row">
        <strong class="trip-name">{{ trip.name }}</strong>
        <label class="switch-label">
          预算
          <n-switch :value="trip.enabledModules.expenses" size="small" @update:value="(v: boolean) => toggleModule(trip, 'expenses', v)" />
        </label>
        <label class="switch-label">
          备忘
          <n-switch :value="trip.enabledModules.notes" size="small" @update:value="(v: boolean) => toggleModule(trip, 'notes', v)" />
        </label>
      </div>
    </n-card>

    <n-card size="small" class="section" title="AI 接口配置">
      <p class="muted small">
        仅支持 OpenAI 兼容接口（如 DeepSeek）。配置只保存在本机浏览器存储，不上传任何服务器。
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
          <n-select
            v-model:value="ai.model"
            :options="modelOptions"
            filterable
            tag
            @update:value="persistAi"
          />
        </n-form-item>
      </n-form>
      <div class="test-row">
        <n-button size="small" :loading="testing" @click="runTest">测试连接</n-button>
        <span v-if="testResult" class="test-result">{{ testResult }}</span>
      </div>
    </n-card>

    <n-card size="small" class="section" title="关于">
      <p class="muted small">
        行囊 Knapsack · 离线优先的旅行规划应用。数据 100% 存本地，无账号、无服务器、无遥测。
      </p>
    </n-card>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 640px;
  margin: 0 auto;
}

@media (max-width: 720px) {
  .page {
    padding: 16px;
  }
}

.section {
  margin-bottom: 16px;
}

.module-row {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 6px 0;
}

.trip-name {
  flex: 1;
}

.switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--app-muted);
}

.appearance-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.appearance-row .small {
  margin-bottom: 0;
}

.test-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.test-result {
  font-size: 13px;
  color: var(--app-success);
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: 12px;
  margin-bottom: 10px;
}
</style>
