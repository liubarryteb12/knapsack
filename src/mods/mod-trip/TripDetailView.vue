<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NTabs, NTabPane } from 'naive-ui'
import { ChevronLeft, MonitorSmartphone } from '@lucide/vue'
import { useTripsStore } from './store'
import TimelineTab from './components/TimelineTab.vue'
import WeatherStrip from './components/WeatherStrip.vue'
import UiStatusBadge from '../../components/ui/UiStatusBadge.vue'
import { destTypeIcon } from './components/icons'
import type { Trip } from './schema'

const BudgetTab = defineAsyncComponent(() => import('./components/BudgetTab.vue'))
const PackingTab = defineAsyncComponent(() => import('./components/PackingTab.vue'))
const NotesTab = defineAsyncComponent(() => import('./components/NotesTab.vue'))
const LanSessionModal = defineAsyncComponent(() => import('./components/LanSessionModal.vue'))

const route = useRoute()
const router = useRouter()
const tripsStore = useTripsStore()
const tripId = computed(() => String(route.params.id))
const trip = computed<Trip | undefined>(() => tripsStore.trips.find((t) => t.id === tripId.value))

const tab = ref('timeline')
const showLan = ref(false)

// 直达路由（刷新/分享链接）时按需读取完整聚合根，列表页只保留摘要。
onMounted(async () => {
  await tripsStore.getTrip(tripId.value)
})

watch(tripId, async () => {
  tab.value = 'timeline'
  await tripsStore.getTrip(tripId.value)
})
</script>

<template>
  <div v-if="trip" class="page">
    <div class="trip-header">
      <n-button quaternary size="small" class="back-btn" @click="router.push('/')">
        <template #icon><ChevronLeft :size="17" /></template>
      </n-button>
      <div class="trip-header-main">
        <div class="trip-title-row">
          <span class="dest-glyph" :data-type="trip.destType">
            <component :is="destTypeIcon[trip.destType]" :size="16" :stroke-width="2" />
          </span>
          <h1>{{ trip.name }}</h1>
          <UiStatusBadge :start-date="trip.startDate" :end-date="trip.endDate" />
        </div>
        <p class="trip-sub">{{ trip.startDate }} ~ {{ trip.endDate }}<span v-if="trip.destCity"> · {{ trip.destCity }}</span></p>
      </div>
      <n-button size="small" @click="showLan = true">
        <template #icon><MonitorSmartphone :size="15" /></template>
        局域网会话
      </n-button>
    </div>

    <n-tabs v-model:value="tab" type="line" animated>
      <n-tab-pane name="timeline" tab="行程">
        <WeatherStrip :key="trip.id" :trip="trip" />
        <TimelineTab :trip="trip" />
      </n-tab-pane>
      <n-tab-pane v-if="trip.enabledModules.expenses" name="budget" tab="预算" display-directive="if">
        <BudgetTab :trip="trip" />
      </n-tab-pane>
      <n-tab-pane name="packing" tab="行李" display-directive="if">
        <PackingTab :trip="trip" />
      </n-tab-pane>
      <n-tab-pane v-if="trip.enabledModules.notes" name="notes" tab="备忘" display-directive="if">
        <NotesTab :trip="trip" />
      </n-tab-pane>
    </n-tabs>

    <LanSessionModal v-if="trip && showLan" v-model:show="showLan" :trip="trip" />
  </div>
  <div v-else class="page">
    <p class="muted">旅行不存在或正在加载…</p>
  </div>
</template>

<style scoped>
.trip-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.back-btn {
  flex-shrink: 0;
}

.trip-header-main {
  flex: 1;
  min-width: 0;
}

.trip-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.trip-title-row h1 {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dest-glyph {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dest-glyph[data-type='city'] {
  background: var(--type-transport-soft);
  color: var(--type-transport);
}

.dest-glyph[data-type='beach'] {
  background: var(--type-play-soft);
  color: var(--type-play);
}

.dest-glyph[data-type='mountain'] {
  background: var(--type-stay-soft);
  color: var(--type-stay);
}

.dest-glyph[data-type='generic'] {
  background: var(--type-other-soft);
  color: var(--type-other);
}

.trip-sub {
  margin-top: 2px;
  color: var(--app-muted);
  font-size: var(--text-sm);
}

@media (max-width: 720px) {
  .page {
    padding: var(--space-4);
  }
}
</style>
