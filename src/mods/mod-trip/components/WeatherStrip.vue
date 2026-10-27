<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
  Droplets, HelpCircle,
} from '@lucide/vue'
import type { Trip } from '../schema'
import { fetchWeather, type DayWeather } from '../services/weather'

const props = defineProps<{ trip: Trip }>()

const weather = ref<Map<string, DayWeather> | null>(null)
const loading = ref(false)

// 组件可能被快速切换（key 绑定 trip.id 时会整体重建，但编辑行程日期等
// 场景会原地复用）：慢网络下旧请求晚返回会覆盖新数据。用自增序号
// 只认最后一次发起的结果。
let seq = 0

async function loadWeather() {
  const mySeq = ++seq
  loading.value = true
  const dates = props.trip.days.map((d) => d.date)
  const result = await fetchWeather(props.trip.destCity, dates).finally(() => {
    if (mySeq === seq) loading.value = false
  })
  if (mySeq !== seq) return
  weather.value = result
  // 失败/离线时 weather 为 null，整个区域 v-if 隐藏，不弹错
}

/** WMO 代码 → Lucide 图标；与 weather.ts 的 desc 分档保持一致 */
function iconOf(code: number): Component {
  if (code === 0) return Sun
  if (code === 1 || code === 2) return CloudSun
  if (code === 3) return Cloud
  if (code === 45 || code === 48) return CloudFog
  if (code >= 51 && code <= 55) return CloudDrizzle
  if (code >= 61 && code <= 65) return CloudRain
  if (code >= 71 && code <= 75) return CloudSnow
  if (code >= 80 && code <= 82) return CloudRain
  if (code >= 95) return CloudLightning
  return HelpCircle
}

const cells = computed(() =>
  weather.value ? [...weather.value.entries()].map(([date, w]) => ({ date, w, Icon: iconOf(w.code) })) : [],
)
</script>

<template>
  <div v-if="weather" class="weather-strip">
    <div v-for="c in cells" :key="c.date" class="weather-cell" :title="c.w.desc">
      <div class="w-date tnum">{{ c.date.slice(5) }}</div>
      <div class="w-icon">
        <component :is="c.Icon" :size="19" :stroke-width="1.8" />
      </div>
      <div class="w-temp tnum">{{ c.w.tempMinC }}~{{ c.w.tempMaxC }}°C</div>
      <div class="w-rain tnum">
        <Droplets :size="11" :stroke-width="2" />
        {{ c.w.precipProbPct }}%
      </div>
    </div>
  </div>
  <div v-else-if="trip.destCity" class="weather-action">
    <button type="button" class="weather-load" :disabled="loading" @click="loadWeather">
      {{ loading ? '正在查询天气…' : '查看目的地天气' }}
    </button>
    <span>仅在点击后联网查询，不会后台请求</span>
  </div>
</template>

<style scoped>
.weather-strip {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  overflow-x: auto;
}

.weather-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  color: var(--app-muted-soft);
  font-size: var(--text-xs);
}

.weather-load {
  padding: 5px 9px;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  background: var(--app-card-bg);
  color: var(--app-text-secondary);
  font: inherit;
  cursor: pointer;
}

.weather-load:disabled {
  cursor: wait;
  opacity: 0.65;
}

.weather-cell {
  flex-shrink: 0;
  border: 1px solid var(--app-weather-border);
  background: var(--app-weather-bg);
  border-radius: var(--radius-md);
  padding: var(--space-2) 10px;
  text-align: center;
  min-width: 76px;
}

.w-date {
  font-size: 11px;
  color: var(--app-weather-text);
}

.w-icon {
  color: var(--app-weather-accent);
  display: flex;
  justify-content: center;
  margin: 2px 0;
}

.w-temp {
  font-size: var(--text-xs);
  font-weight: 600;
}

.w-rain {
  font-size: 11px;
  color: var(--app-weather-text);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
</style>
