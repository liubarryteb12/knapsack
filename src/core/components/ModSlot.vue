<script setup lang="ts">
import { computed } from 'vue'
import { modRegistry } from '../bootMods'
import type { ModSlotName } from '../modRegistry'

const props = withDefaults(
  defineProps<{
    name: ModSlotName
    slotProps?: Record<string, unknown>
  }>(),
  {
    slotProps: () => ({}),
  },
)

const entries = computed(() => modRegistry.slots.resolve(props.name))
</script>

<template>
  <component
    :is="entry.component"
    v-for="entry in entries"
    :key="entry.modId + entry.targetSlot"
    v-bind="{ ...slotProps, ...entry.props }"
  />
</template>
