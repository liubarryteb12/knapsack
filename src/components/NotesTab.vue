<script setup lang="ts">
import ActualNotesTab from '../mods/mod-trip/components/NotesTab.vue'
import type { Trip } from '../mods/mod-trip/schema'

defineProps<{ trip: Trip }>()
</script>

<template>
  <ActualNotesTab :trip="trip" />
</template>
