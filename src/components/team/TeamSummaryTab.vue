<script setup lang="ts">
import type { TeamState } from '../../mods/mod-team/domain/schema'
import TeamSummaryTab from '../../mods/mod-team/components/TeamSummaryTab.vue'

defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
</script>

<template>
  <TeamSummaryTab :team="team" @changed="emit('changed')" />
</template>
