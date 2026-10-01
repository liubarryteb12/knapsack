<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Trip } from '../schema/trip'
import { fetchWeather, type DayWeather } from '../utils/weather'

const props = defineProps<{ trip: Trip }>()

const weather = ref<Map<string, DayWeather> | null>(null)

onMounted(async () => {
  const dates = props.trip.days.map((d) => d.date)
  weather.value = await fetchWeather(props.trip.destCity, dates)
  // 失败/离线时 weather 为 null，整个区域 v-if 隐藏，不弹错
})
</script>

<template>
  <div v-if="weather" class="weather-strip">
    <div v-for="[date, w] in weather" :key="date" class="weather-cell" :title="w.desc">
      <div class="w-date">{{ date.slice(5) }}</div>
      <div class="w-icon">{{ w.icon }}</div>
      <div class="w-temp">{{ w.tempMinC }}~{{ w.tempMaxC }}°C</div>
      <div class="w-rain">💧{{ w.precipProbPct }}%</div>
    </div>
  </div>
</template>

<style scoped>
.weather-strip {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.weather-cell {
  flex-shrink: 0;
  border: 1px solid #e0f2fe;
  background: #f0f9ff;
  border-radius: 8px;
  padding: 6px 10px;
  text-align: center;
  min-width: 76px;
}

.w-date {
  font-size: 11px;
  color: #64748b;
}

.w-icon {
  font-size: 18px;
}

.w-temp {
  font-size: 12px;
  font-weight: 600;
}

.w-rain {
  font-size: 11px;
  color: #38bdf8;
}
</style>
