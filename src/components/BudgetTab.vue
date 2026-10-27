<script setup lang="ts">
import ActualBudgetTab from '../mods/mod-trip/components/BudgetTab.vue'
import type { Trip } from '../mods/mod-trip/schema'

defineProps<{ trip: Trip }>()
</script>

<template>
  <ActualBudgetTab :trip="trip" />
</template>
