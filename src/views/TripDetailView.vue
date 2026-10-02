<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NTabs, NTabPane } from 'naive-ui'
import { useTripsStore } from '../stores/trips'
import TimelineTab from '../components/TimelineTab.vue'
import BudgetTab from '../components/BudgetTab.vue'
import PackingTab from '../components/PackingTab.vue'
import NotesTab from '../components/NotesTab.vue'
import WeatherStrip from '../components/WeatherStrip.vue'
import type { Trip } from '../schema/trip'

const route = useRoute()
const tripsStore = useTripsStore()
const tripId = computed(() => String(route.params.id))
const trip = computed<Trip | undefined>(() => tripsStore.trips.find((t) => t.id === tripId.value))

const tab = ref('timeline')

// 直达路由（刷新/分享链接）时 store 尚未加载，先 load 再兜底查库
onMounted(async () => {
  if (!tripsStore.loaded) await tripsStore.load()
})

watch(tripId, async () => {
  tab.value = 'timeline'
  if (!tripsStore.loaded) await tripsStore.load()
})
</script>

<template>
  <div v-if="trip" class="page">
    <div class="page-header">
      <div>
        <h1>{{ trip.name }}</h1>
        <p class="muted">{{ trip.startDate }} ~ {{ trip.endDate }}<span v-if="trip.destCity"> · {{ trip.destCity }}</span></p>
      </div>
    </div>

    <n-tabs v-model:value="tab" type="line" animated>
      <n-tab-pane name="timeline" tab="行程">
        <WeatherStrip :trip="trip" />
        <TimelineTab :trip="trip" />
      </n-tab-pane>
      <n-tab-pane v-if="trip.enabledModules.expenses" name="budget" tab="预算">
        <BudgetTab :trip="trip" />
      </n-tab-pane>
      <n-tab-pane name="packing" tab="行李">
        <PackingTab :trip="trip" />
      </n-tab-pane>
      <n-tab-pane v-if="trip.enabledModules.notes" name="notes" tab="备忘">
        <NotesTab :trip="trip" />
      </n-tab-pane>
    </n-tabs>
  </div>
  <div v-else class="page">
    <p class="muted">旅行不存在或正在加载…</p>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 12px;
}

.muted {
  color: #9ca3af;
  font-size: 13px;
}

@media (max-width: 720px) {
  .page {
    padding: 16px;
  }
}
</style>
