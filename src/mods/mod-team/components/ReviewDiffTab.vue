<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NTag, useMessage } from 'naive-ui'
import { Check, Eye, X } from '@lucide/vue'
import { modRegistry } from '../../../core/bootMods'
import {
  SHAREABLE_PACKAGE_IMPORT_TOPIC,
  type ShareablePackageImportResult,
} from '../../../core/types/shareable-package.schema'
import { diffJson, type JsonDiffEntry } from '../../../engines/lan-share-engine/diff-engine'
import type { TeamPackageRecord } from '../schema/team-package.schema'
import { effectivePending, useTeamPackageStore } from '../store/teamPackageStore'

const store = useTeamPackageStore()
const message = useMessage()
const selectedId = ref<string | null>(null)
const processing = ref<string | null>(null)
const busy = computed(() => processing.value !== null)

const pending = computed(() => effectivePending(store.records))

const selected = computed(
  () => pending.value.find((record) => record.recordId === selectedId.value) ?? pending.value[0] ?? null,
)

const changes = computed<JsonDiffEntry[]>(() => {
  const record = selected.value
  if (!record?.previousPackage) return []
  return diffJson(record.previousPackage.payload, record.package.payload)
})

function pathText(path: JsonDiffEntry['path']): string {
  return path.length === 0
    ? 'payload'
    : path.map((part) => typeof part === 'number' ? `[${part}]` : `.${part}`).join('').replace(/^\./, '')
}

function valueText(value: unknown): string {
  if (value === undefined) return '无'
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '无'
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

function sourceLabel(sourceModId: string): string {
  return {
    'mod-trip': '旅行',
    'mod-prompts': '提示词',
    'mod-daily': '每日计划',
    'mod-finance': '账房',
  }[sourceModId] ?? sourceModId
}

async function accept(record: TeamPackageRecord) {
  if (busy.value) return
  processing.value = record.recordId
  try {
    const results = await modRegistry.capabilities.query<ShareablePackageImportResult>(
      SHAREABLE_PACKAGE_IMPORT_TOPIC,
      {
        package: record.package,
        groupId: record.groupId ?? undefined,
        approvedByHost: true,
        mode: record.package.permissionMode === 'READ_ONLY' ? 'LOCAL_COPY' : 'MERGE',
      },
    )
    const accepted = results.find((result) => result.accepted)
    if (!accepted) {
      const reason = results.find((result) => result.message)?.message ?? '没有业务模块接受该共享包'
      throw new Error(reason)
    }
    await store.setStatus(record.recordId, 'ACCEPTED')
    selectedId.value = null
    message.success(accepted.message)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    processing.value = null
  }
}

async function reject(record: TeamPackageRecord) {
  if (busy.value) return
  processing.value = record.recordId
  try {
    await store.setStatus(record.recordId, 'REJECTED')
    selectedId.value = null
    message.success('已驳回共享包')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    processing.value = null
  }
}
</script>

<template>
  <div class="review-layout">
    <div class="review-list">
      <n-empty v-if="pending.length === 0" description="没有待审核共享包" />
      <button
        v-for="record in pending"
        :key="record.recordId"
        class="review-item"
        :class="{ active: selected?.recordId === record.recordId }"
        :disabled="busy"
        @click="selectedId = record.recordId"
      >
        <div class="review-item-head">
          <strong>{{ record.package.title }}</strong>
          <n-tag
            v-if="record.previousPackage"
            type="warning"
            size="tiny"
            :bordered="false"
          >
            已修订 · v{{ record.package.revision }}
          </n-tag>
        </div>
        <span>
          {{ sourceLabel(record.package.sourceModId) }} ·
          {{ record.package.permissionMode === 'READ_ONLY' ? '只读分发' : '协同修订' }}
        </span>
      </button>
    </div>

    <n-card v-if="selected" size="small" class="review-detail" :title="selected.package.title">
      <template #header-extra>
        <n-tag size="small" :bordered="false">{{ selected.package.packageType }}</n-tag>
      </template>
      <p class="muted">{{ selected.package.releaseNote || '未填写发布说明' }}</p>
      <div class="review-meta">
        <span>作者：{{ selected.package.author.nickname }}</span>
        <span>版本：v{{ selected.package.revision }}</span>
        <span>摘要：{{ selected.package.digest.slice(0, 16) }}</span>
      </div>

      <n-alert v-if="!selected.previousPackage && changes.length === 0" type="info" :bordered="false">
        首次接收，没有旧版本可对比。可直接预览 payload 后决定是否采纳。
      </n-alert>

      <div v-if="changes.length > 0" class="diff-list">
        <div v-for="(change, index) in changes" :key="`${change.op}-${index}`" class="diff-row">
          <n-tag size="tiny" :bordered="false" :type="change.op === 'remove' ? 'error' : change.op === 'add' ? 'success' : 'warning'">
            {{ change.op }}
          </n-tag>
          <code>{{ pathText(change.path) }}</code>
          <div class="diff-values">
            <span v-if="change.op !== 'add'" class="before">{{ valueText(change.before) }}</span>
            <span v-if="change.op !== 'remove'" class="after">{{ valueText(change.after) }}</span>
          </div>
        </div>
      </div>

      <details v-else class="payload-preview">
        <summary><Eye :size="14" /> 查看完整 payload</summary>
        <pre>{{ JSON.stringify(selected.package.payload, null, 2) }}</pre>
      </details>

      <template #footer>
        <div class="review-actions">
          <n-button type="error" quaternary :disabled="busy" @click="reject(selected)">
            <template #icon><X :size="15" /></template>
            驳回
          </n-button>
          <n-button type="primary" :loading="processing === selected.recordId" :disabled="busy" @click="accept(selected)">
            <template #icon><Check :size="15" /></template>
            采纳并合入
          </n-button>
        </div>
      </template>
    </n-card>
  </div>
</template>

<style scoped>
.review-layout {
  display: grid;
  grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.5fr);
  gap: var(--space-4);
  align-items: start;
}

.review-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.review-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-3);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-card-bg);
  color: var(--app-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.review-item.active {
  border-color: var(--app-accent);
  background: var(--app-accent-soft);
}

.review-item:disabled {
  cursor: wait;
  opacity: 0.7;
}

.review-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.review-item > span,
.muted,
.review-meta {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.review-meta {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin: var(--space-2) 0 var(--space-3);
}

.diff-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.diff-row {
  display: grid;
  grid-template-columns: auto minmax(100px, auto) minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
  padding: var(--space-2) 0;
  border-top: 1px solid var(--app-border);
}

.diff-row code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.diff-values {
  display: flex;
  gap: var(--space-2);
  flex-direction: column;
  min-width: 0;
  font-size: var(--text-xs);
}

.diff-values span {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}

.before {
  color: var(--app-danger);
  text-decoration: line-through;
}

.after {
  color: var(--app-success);
}

.payload-preview {
  margin-top: var(--space-3);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.payload-preview summary {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.payload-preview pre {
  max-height: 260px;
  overflow: auto;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--app-code-bg);
  color: var(--app-text);
  font-size: 11px;
}

.review-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 760px) {
  .review-layout {
    grid-template-columns: 1fr;
  }

  .diff-row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .diff-values {
    grid-column: 1 / -1;
  }
}
</style>
