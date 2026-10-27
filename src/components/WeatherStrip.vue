<script setup lang="ts">
import ActualWeatherStrip from '../mods/mod-trip/components/WeatherStrip.vue'
import type { Trip } from '../mods/mod-trip/schema'

defineProps<{ trip: Trip }>()
</script>

<template>
  <ActualWeatherStrip :trip="trip" />
</template>
