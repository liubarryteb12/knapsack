<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
  Droplets, HelpCircle,
} from '@lucide/vue'
import type { Trip } from '../schema/trip'
import { fetchWeather, type DayWeather } from '../utils/weather'

const props = defineProps<{ trip: Trip }>()

const weather = ref<Map<string, DayWeather> | null>(null)

onMounted(async () => {
  const dates = props.trip.days.map((d) => d.date)
  weather.value = await fetchWeather(props.trip.destCity, dates)
  // 失败/离线时 weather 为 null，整个区域 v-if 隐藏，不弹错
})

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
</template>

<style scoped>
.weather-strip {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  overflow-x: auto;
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
