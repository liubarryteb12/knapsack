<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NCard,
  NTabPane,
  NTabs,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  Inbox,
  PackageCheck,
  QrCode,
  ShieldCheck,
  Users,
} from '@lucide/vue'
import UiEmptyState from '../../../components/ui/UiEmptyState.vue'
import UiPageHeader from '../../../components/ui/UiPageHeader.vue'
import UiStatCard from '../../../components/ui/UiStatCard.vue'
import { modRegistry } from '../../../core/bootMods'
import {
  SHAREABLE_PACKAGE_EXPORT_TOPIC,
  type ShareablePackage,
} from '../../../core/types/shareable-package.schema'
import PackagePackerModal from '../components/PackagePackerModal.vue'
import QrTransceiverModal from '../components/QrTransceiverModal.vue'
import ReviewDiffTab from '../components/ReviewDiffTab.vue'
import type { TeamPackageRecord } from '../schema/team-package.schema'
import { useTeamsStore } from '../store'
import { useTeamPackageStore } from '../store/teamPackageStore'

const router = useRouter()
const teams = useTeamsStore()
const packages = useTeamPackageStore()
const message = useMessage()
const activeTab = ref<'workspace' | 'review'>('workspace')
const showPacker = ref(false)
const showTransceiver = ref(false)
const loadingExports = ref(false)
const availablePackages = ref<ShareablePackage[]>([])
const packingPermissionMode = ref<ShareablePackage['permissionMode']>('COLLABORATIVE')

onMounted(async () => {
  await Promise.all([teams.load(), packages.load()])
})

function sourceLabel(sourceModId: string): string {
  return {
    'mod-trip': '旅行',
    'mod-prompts': '提示词',
    'mod-daily': '每日计划',
    'mod-finance': '账房',
  }[sourceModId] ?? sourceModId
}

function statusLabel(record: TeamPackageRecord): string {
  return {
    READY: '待发送',
    PENDING_REVIEW: '待审核',
    ACCEPTED: '已采纳',
    REJECTED: '已驳回',
  }[record.status]
}

function statusType(record: TeamPackageRecord): 'default' | 'info' | 'success' | 'error' {
  return {
    READY: 'info',
    PENDING_REVIEW: 'info',
    ACCEPTED: 'success',
    REJECTED: 'error',
  }[record.status] as 'default' | 'info' | 'success' | 'error'
}

async function loadExports(
  permissionMode: ShareablePackage['permissionMode'],
  openModal: boolean,
): Promise<void> {
  loadingExports.value = true
  try {
    const result = await modRegistry.capabilities.queryDetailed<ShareablePackage[]>(
      SHAREABLE_PACKAGE_EXPORT_TOPIC,
      { permissionMode },
    )
    availablePackages.value = result.values.flat().sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )
    if (result.failures.length > 0) {
      message.warning(
        `部分来源导出失败：${result.failures.map((failure) => failure.modId).join('、')}`,
      )
    }
    if (openModal) showPacker.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    loadingExports.value = false
  }
}

async function openPacker() {
  await loadExports(packingPermissionMode.value, true)
}

async function refreshExports(permissionMode: ShareablePackage['permissionMode']) {
  packingPermissionMode.value = permissionMode
  await loadExports(permissionMode, false)
}

async function refreshPackages() {
  await packages.load()
}
</script>

<template>
  <div class="team-hub">
    <UiPageHeader title="团队分享" subtitle="把旅行、计划和提示词装成标准包，面对面扫码发送与审核合入">
      <n-button @click="router.push('/teams')">
        <template #icon><Users :size="16" /></template>
        管理群组
      </n-button>
      <n-button :loading="loadingExports" @click="openPacker">
        <template #icon><PackageCheck :size="16" /></template>
        装箱分享
      </n-button>
      <n-button type="primary" @click="showTransceiver = true">
        <template #icon><QrCode :size="16" /></template>
        扫码收发
      </n-button>
    </UiPageHeader>

    <div class="stats-row">
      <UiStatCard :icon="Users" label="群组" :value="`${teams.teamList.length} 个`" />
      <UiStatCard :icon="PackageCheck" label="已装箱" :value="`${packages.sentCount} 个`" />
      <UiStatCard :icon="Inbox" label="已接收" :value="`${packages.receivedCount} 个`" />
      <UiStatCard :icon="ShieldCheck" label="待审核" :value="`${packages.pending.length} 个`" />
    </div>

    <n-tabs v-model:value="activeTab" type="line" animated>
      <n-tab-pane name="workspace" tab="共享工作台">
        <div class="workspace-grid">
          <section class="group-section">
            <div class="section-head">
              <div>
                <h2>我的群组</h2>
                <p>群组负责花名册与权限，扫码传输不依赖云端。</p>
              </div>
              <n-button size="small" @click="router.push('/teams')">新建 / 加入</n-button>
            </div>

            <UiEmptyState
              v-if="teams.loaded && teams.teamList.length === 0"
              title="还没有群组"
              description="先创建一个旅行团、家庭组或提示词研习社。"
            >
              <n-button type="primary" @click="router.push('/teams')">创建群组</n-button>
            </UiEmptyState>

            <div v-else class="group-grid">
              <button
                v-for="group in teams.teamList"
                :key="group.teamId"
                class="group-card"
                @click="router.push(`/team/${group.teamId}`)"
              >
                <div class="group-head">
                  <strong>{{ group.name }}</strong>
                  <n-tag size="tiny" :bordered="false">{{ group.roster.length }} 人</n-tag>
                </div>
                <span>{{ group.items.length }} 项物资 · {{ group.checkpoints.length }} 个节点</span>
                <span class="group-foot">
                  {{ group.latestPublication ? `已发布 v${group.latestPublication.version}` : '尚未发布快照' }}
                </span>
              </button>
            </div>
          </section>

          <section class="history-section">
            <div class="section-head">
              <div>
                <h2>共享包历史</h2>
                <p>发送箱进入二维码轮播，接收包先进入审核。</p>
              </div>
              <n-button size="small" @click="refreshPackages">刷新</n-button>
            </div>

            <UiEmptyState
              v-if="packages.records.length === 0"
              title="还没有共享包"
              description="点击「装箱分享」选择旅行、提示词或每日计划。"
            />

            <n-card v-else size="small">
              <div class="package-table">
                <div class="package-table-head">
                  <span>共享包</span><span>来源</span><span>方向</span><span>状态</span><span>更新时间</span>
                </div>
                <div v-for="record in packages.records" :key="record.recordId" class="package-row">
                  <div class="package-name">
                    <strong>{{ record.package.title }}</strong>
                    <span>v{{ record.package.revision }} · {{ record.package.packageType }}</span>
                  </div>
                  <span>{{ sourceLabel(record.package.sourceModId) }}</span>
                  <span>{{ record.direction === 'SENT' ? '发送' : '接收' }}</span>
                  <n-tag size="tiny" :bordered="false" :type="statusType(record)">
                    {{ statusLabel(record) }}
                  </n-tag>
                  <span>{{ new Date(record.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                </div>
              </div>
            </n-card>
          </section>
        </div>
      </n-tab-pane>

      <n-tab-pane name="review" tab="待审与 Diff">
        <ReviewDiffTab />
      </n-tab-pane>
    </n-tabs>

    <PackagePackerModal
      v-model:show="showPacker"
      :packages="availablePackages"
      :groups="teams.teamList"
      :permission-mode="packingPermissionMode"
      :refreshing="loadingExports"
      @update:permission-mode="packingPermissionMode = $event"
      @refresh="refreshExports"
      @packed="refreshPackages"
    />
    <QrTransceiverModal
      v-model:show="showTransceiver"
      :records="packages.records"
      @received="refreshPackages"
    />
  </div>
</template>

<style scoped>
.team-hub {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6);
}

.stats-row {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.4fr);
  gap: var(--space-4);
}

.group-section,
.history-section {
  min-width: 0;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.section-head h2 {
  margin: 0 0 3px;
  font-size: var(--text-lg);
}

.section-head p {
  margin: 0;
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}

.group-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-card-bg);
  color: var(--app-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.group-card:hover {
  border-color: var(--app-accent);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.group-head strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-card > span,
.group-foot {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.package-table {
  min-width: 620px;
}

.history-section :deep(.n-card__content) {
  overflow-x: auto;
}

.package-table-head,
.package-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) 90px 70px 80px 120px;
  gap: var(--space-3);
  align-items: center;
}

.package-table-head {
  padding-bottom: var(--space-2);
  color: var(--app-muted);
  font-size: var(--text-xs);
  border-bottom: 1px solid var(--app-border);
}

.package-row {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--app-border);
  font-size: var(--text-xs);
}

.package-row:last-child {
  border-bottom: 0;
}

.package-name {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.package-name strong,
.package-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-name span {
  color: var(--app-muted);
}

@media (max-width: 900px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .team-hub {
    padding: var(--space-4);
  }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
