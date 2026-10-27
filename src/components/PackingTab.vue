<script setup lang="ts">
import ActualPackingTab from '../mods/mod-trip/components/PackingTab.vue'
import type { Trip } from '../mods/mod-trip/schema'

defineProps<{ trip: Trip }>()
</script>

<template>
  <ActualPackingTab :trip="trip" />
</template>
