<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NCard, NTag } from 'naive-ui'
import { Wallet } from '@lucide/vue'
import type { DailyExpenseBrief } from '../../../core/capabilityContracts'
import { formatFen } from '../../../utils/money'
import { getDailyExpenseBrief } from '../services/dailyBrief'

const props = defineProps<{
  logicalDate?: string
}>()

const brief = ref<DailyExpenseBrief | null>(null)
const visible = computed(() => !!brief.value && brief.value.count > 0)

async function load() {
  brief.value = props.logicalDate ? await getDailyExpenseBrief(props.logicalDate) : null
}

onMounted(load)
watch(() => props.logicalDate, load)
</script>

<template>
  <n-card v-if="visible && brief" size="small" class="expense-brief">
    <div class="brief-row">
      <span class="brief-icon"><Wallet :size="16" /></span>
      <strong>今日开销</strong>
      <span class="amount">{{ formatFen(brief.totalCents) }}</span>
      <n-tag size="small" :bordered="false">{{ brief.count }} 笔</n-tag>
      <span v-if="brief.topCategory" class="muted">最多：{{ brief.topCategory }}</span>
    </div>
  </n-card>
</template>

<style scoped>
.expense-brief {
  margin-top: var(--space-4);
}

.brief-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.brief-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--type-play-soft);
  color: var(--type-play);
}

.amount {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--app-muted);
  font-size: var(--text-xs);
}
</style>
