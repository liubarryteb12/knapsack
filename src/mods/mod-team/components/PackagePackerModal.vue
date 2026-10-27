<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NModal,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import { PackagePlus } from '@lucide/vue'
import { nanoid } from 'nanoid'
import type { ShareablePackage } from '../../../core/types/shareable-package.schema'
import type { TeamListItem } from '../db/actions'
import { TEAM_PACKAGE_RECORD_FORMAT, type TeamPackageRecord } from '../schema/team-package.schema'
import { useTeamPackageStore } from '../store/teamPackageStore'

const props = defineProps<{
  show: boolean
  packages: ShareablePackage[]
  groups: TeamListItem[]
  permissionMode: ShareablePackage['permissionMode']
  refreshing: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'update:permissionMode': [value: ShareablePackage['permissionMode']]
  refresh: [value: ShareablePackage['permissionMode']]
  packed: [records: TeamPackageRecord[]]
}>()

const store = useTeamPackageStore()
const message = useMessage()
const selectedIds = ref<string[]>([])
const groupId = ref<string | null>(null)
const saving = ref(false)

watch(
  () => props.show,
  (show) => {
    if (!show) return
    selectedIds.value = props.packages.length === 1 ? [props.packages[0]!.packageId] : []
    groupId.value = props.groups[0]?.teamId ?? null
  },
)

const groupOptions = computed(() =>
  props.groups.map((group) => ({ value: group.teamId, label: group.name })),
)

const permissionOptions: Array<{
  value: ShareablePackage['permissionMode']
  label: string
}> = [
  { value: 'COLLABORATIVE', label: '协同上报' },
  { value: 'READ_ONLY', label: '只读分发' },
]

function changePermission(value: ShareablePackage['permissionMode']) {
  if (value === props.permissionMode) return
  selectedIds.value = []
  emit('update:permissionMode', value)
  emit('refresh', value)
}

function sourceLabel(sourceModId: string): string {
  return {
    'mod-trip': '旅行',
    'mod-prompts': '提示词',
    'mod-daily': '每日计划',
    'mod-finance': '账房',
  }[sourceModId] ?? sourceModId
}

async function pack() {
  const selected = props.packages.filter((item) => selectedIds.value.includes(item.packageId))
  if (selected.length === 0) {
    message.warning('至少选择一个共享包')
    return
  }
  saving.value = true
  try {
    const now = Date.now()
    const records: TeamPackageRecord[] = []
    for (const item of selected) {
      records.push({
        format: TEAM_PACKAGE_RECORD_FORMAT,
        recordId: nanoid(14),
        groupId: groupId.value,
        packageId: item.packageId,
        direction: 'SENT',
        status: 'READY',
        package: JSON.parse(JSON.stringify(item)) as ShareablePackage,
        previousPackage: null,
        createdAt: now,
        updatedAt: now,
      })
    }
    const saved = await store.saveMany(records)
    emit('packed', saved)
    emit('update:show', false)
    message.success(`已装箱 ${saved.length} 个共享包`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="装箱分享"
    style="width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px)"
    content-style="max-height: calc(100vh - 210px); overflow-y: auto"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="packer">
      <div class="packer-top">
        <label>
          所属群组
          <n-select
            v-model:value="groupId"
            :options="groupOptions"
            clearable
            placeholder="不关联群组也可当面分享"
          />
        </label>
        <label>
          分享权限
          <n-select
            :value="permissionMode"
            :options="permissionOptions"
            :disabled="refreshing || saving"
            @update:value="changePermission"
          />
        </label>
        <n-tag :bordered="false">{{ selectedIds.length }} 个已选</n-tag>
        <n-tag v-if="refreshing" type="info" :bordered="false">正在刷新可分享数据</n-tag>
      </div>

      <n-alert v-if="packages.length === 0" type="info" :bordered="false">
        当前没有可分享数据。请先在旅行、提示词或每日计划中创建内容。
      </n-alert>

      <n-checkbox-group v-else v-model:value="selectedIds">
        <div class="package-grid">
          <n-card
            v-for="item in packages"
            :key="item.packageId"
            size="small"
            class="package-card"
            :class="{ selected: selectedIds.includes(item.packageId) }"
          >
            <div class="package-head">
              <n-checkbox :value="item.packageId" />
              <div class="package-title">
                <strong>{{ item.title }}</strong>
                <span>{{ sourceLabel(item.sourceModId) }} · {{ item.packageType }}</span>
              </div>
              <n-tag size="tiny" :bordered="false">
                {{ item.permissionMode === 'READ_ONLY' ? '只读' : '可协同' }}
              </n-tag>
            </div>
            <p class="release-note">{{ item.releaseNote || '未填写发布说明' }}</p>
            <div class="package-meta">
              <span>v{{ item.revision }}</span>
              <span>{{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}</span>
              <span class="digest">{{ item.digest.slice(0, 12) }}</span>
            </div>
          </n-card>
        </div>
      </n-checkbox-group>
    </div>

    <template #footer>
      <div class="modal-foot">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="selectedIds.length === 0 || refreshing" @click="pack">
          <template #icon><PackagePlus :size="15" /></template>
          确认装箱
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.packer {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.packer-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.packer-top label {
  flex: 1;
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.package-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}

.package-card {
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}

.package-card.selected {
  border-color: var(--app-accent);
  background: var(--app-accent-soft);
}

.package-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.package-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.package-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-title span,
.package-meta {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.release-note {
  min-height: 38px;
  margin: var(--space-2) 0;
  color: var(--app-text-secondary);
  font-size: var(--text-sm);
}

.package-meta {
  display: flex;
  gap: var(--space-2);
}

.digest {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 620px) {
  .packer-top {
    align-items: stretch;
    flex-direction: column;
  }

  .packer-top label {
    grid-template-columns: 1fr;
  }

  .package-grid {
    grid-template-columns: 1fr;
  }
}
</style>
