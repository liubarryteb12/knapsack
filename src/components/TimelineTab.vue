<script setup lang="ts">
import ActualTimelineTab from '../mods/mod-trip/components/TimelineTab.vue'
import type { Trip } from '../mods/mod-trip/schema'

defineProps<{ trip: Trip }>()
</script>

<template>
  <ActualTimelineTab :trip="trip" />
</template>
