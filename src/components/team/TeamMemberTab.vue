<script setup lang="ts">
import type { TeamState } from '../../mods/mod-team/domain/schema'
import TeamMemberTab from '../../mods/mod-team/components/TeamMemberTab.vue'

defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
</script>

<template>
  <TeamMemberTab :team="team" @changed="emit('changed')" />
</template>
