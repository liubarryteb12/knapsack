<script setup lang="ts">
import ActualAiDraftModal from '../mods/mod-trip/components/AiDraftModal.vue'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()
</script>

<template>
  <ActualAiDraftModal :show="show" @update:show="emit('update:show', $event)" />
</template>
