<script setup lang="ts">
import type { TeamState } from '../../mods/mod-team/domain/schema'
import TeamPublishTab from '../../mods/mod-team/components/TeamPublishTab.vue'

defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
</script>

<template>
  <TeamPublishTab :team="team" @changed="emit('changed')" />
</template>
