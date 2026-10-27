<script setup lang="ts">
import ActualLanSessionModal from '../mods/mod-trip/components/LanSessionModal.vue'
import type { Trip } from '../mods/mod-trip/schema'

defineProps<{ show: boolean; trip: Trip }>()
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()
</script>

<template>
  <ActualLanSessionModal :show="show" :trip="trip" @update:show="emit('update:show', $event)" />
</template>
