<script setup lang="ts">
/**
 * 团队详情：按角色分支。
 * - 组织者（主机）：分工设置、汇总确认、发布与会话
 * - 成员：连接主机、我的任务、上报与领取
 * 主机权威数据与成员本地视图共用同一 TeamState，但只有主机能确认/发布（服务端授权）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NTabs, NTabPane, NTag } from 'naive-ui'
import { ArrowLeft } from '@lucide/vue'
import { useTeamsStore } from '../stores/teams'
import { stopTeamHost, currentTeamSession } from '../team/teamHostService'
import UiPageHeader from '../components/ui/UiPageHeader.vue'
import UiEmptyState from '../components/ui/UiEmptyState.vue'
import TeamSetupTab from '../components/team/TeamSetupTab.vue'
import TeamSummaryTab from '../components/team/TeamSummaryTab.vue'
import TeamPublishTab from '../components/team/TeamPublishTab.vue'
import TeamMemberTab from '../components/team/TeamMemberTab.vue'

const route = useRoute()
const router = useRouter()
const teams = useTeamsStore()

const teamId = computed(() => String(route.params.id ?? ''))
const team = computed(() => teams.byId(teamId.value))
const isOrganizer = computed(() => {
  const t = team.value
  if (!t) return false
  const me = t.roster.find((m) => m.memberId === t.myMemberId)
  return me?.role === 'organizer'
})

const activeTab = ref('setup')

onMounted(async () => {
  if (!teams.loaded) await teams.load()
  await teams.refresh(teamId.value)
})

// 会话在离开页面时停止（第一版前台会话，SPEC 7.3）
watch(
  () => route.fullPath,
  async (now, prev) => {
    if (prev && prev.includes(`/team/${teamId.value}`) && !now.includes(`/team/${teamId.value}`)) {
      if (currentTeamSession()) {
        await stopTeamHost().catch(() => {})
      }
    }
  },
)

async function reload() {
  await teams.refresh(teamId.value)
}

function back() {
  void router.push('/teams')
}
</script>

<template>
  <div class="page">
    <UiPageHeader :title="team?.name ?? '团队'" :subtitle="isOrganizer ? '你是组织者（汇总主机）' : '你是团队成员'">
      <n-button @click="back">
        <template #icon><ArrowLeft :size="16" /></template>
        返回
      </n-button>
    </UiPageHeader>

    <UiEmptyState
      v-if="!team"
      title="找不到这个团队"
      description="可能已被删除，或本机没有加入记录。"
    />

    <template v-else>
      <div class="meta-row">
        <n-tag size="small" :bordered="false">{{ team.roster.length }} 名成员</n-tag>
        <n-tag size="small" :bordered="false">{{ team.items.length }} 项物资</n-tag>
        <n-tag size="small" :bordered="false">{{ team.checkpoints.length }} 个节点</n-tag>
        <n-tag v-if="team.latestPublication" size="small" type="success" :bordered="false">
          已发布第 {{ team.latestPublication.version }} 版
        </n-tag>
        <n-tag v-else size="small" type="warning" :bordered="false">尚未发布</n-tag>
      </div>

      <n-tabs v-if="isOrganizer" v-model:value="activeTab" type="line" animated>
        <n-tab-pane name="setup" tab="分工设置">
          <TeamSetupTab :team="team" @changed="reload" />
        </n-tab-pane>
        <n-tab-pane name="summary" tab="汇总与确认">
          <TeamSummaryTab :team="team" @changed="reload" />
        </n-tab-pane>
        <n-tab-pane name="publish" tab="会话与发布">
          <TeamPublishTab :team="team" @changed="reload" />
        </n-tab-pane>
      </n-tabs>

      <TeamMemberTab v-else :team="team" @changed="reload" />
    </template>
  </div>
</template>

<style scoped>
.page {
  padding: var(--space-6);
  max-width: 1100px;
  margin: 0 auto;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
</style>
