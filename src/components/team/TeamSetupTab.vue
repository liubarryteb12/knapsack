<script setup lang="ts">
import type { TeamState } from '../../mods/mod-team/domain/schema'
import TeamSetupTab from '../../mods/mod-team/components/TeamSetupTab.vue'

defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
</script>

<template>
  <TeamSetupTab :team="team" @changed="emit('changed')" />
</template>
