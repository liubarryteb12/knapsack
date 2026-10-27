<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NTag } from 'naive-ui'
import { useRouter } from 'vue-router'
import type { DailyTripContext } from '../../../core/capabilityContracts'
import { getDailyTripContext } from '../services/dailyTripContext'

const props = defineProps<{
  logicalDate?: string
}>()

const router = useRouter()
const context = ref<DailyTripContext | null>(null)

async function load() {
  context.value = props.logicalDate ? await getDailyTripContext(props.logicalDate) : null
}

onMounted(load)
watch(() => props.logicalDate, load)
</script>

<template>
  <n-alert v-if="context" type="info" :bordered="false" class="trip-banner">
    <div class="trip-banner-row">
      <n-tag size="small" :bordered="false">旅行中</n-tag>
      <strong>{{ context.tripName }}</strong>
      <span v-if="context.destCity" class="muted">{{ context.destCity }}</span>
      <span v-if="context.dayTitle" class="day-title">{{ context.dayTitle }}</span>
      <n-button
        text
        type="primary"
        class="trip-link"
        @click="router.push(`/trip/${context.tripId}`)"
      >
        打开行程
      </n-button>
    </div>
  </n-alert>
</template>

<style scoped>
.trip-banner {
  margin-bottom: var(--space-4);
}

.trip-banner-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.muted {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.day-title {
  flex: 1 1 220px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-text-secondary);
  font-size: var(--text-sm);
}

.trip-link {
  margin-left: auto;
}
</style>
