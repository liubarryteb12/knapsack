<script setup lang="ts">
/**
 * 团队筹备列表：我组织的团队 + 我加入的团队；支持创建与扫码加入。
 * 成员加入不需要先建同名私人 Trip（SPEC 8）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NInput,
  NModal,
  NForm,
  NFormItem,
  NPopconfirm,
  NTag,
  useMessage,
} from 'naive-ui'
import { Plus, ScanLine, Users, Crown, ClipboardList, Trash2 } from '@lucide/vue'
import { useTeamsStore } from '../stores/teams'
import { joinTeam } from '../team/teamClient'
import { parseHostTicket } from '../team/identity'
import { canScan } from '../utils/lanSessionScan'
import QrScanner from '../components/QrScanner.vue'
import UiPageHeader from '../components/ui/UiPageHeader.vue'
import UiEmptyState from '../components/ui/UiEmptyState.vue'
import type { TeamListItem } from '../db/teamActions'
import { currentTeamSession, stopTeamHost } from '../team/teamHostService'

const router = useRouter()
const teams = useTeamsStore()
const message = useMessage()

onMounted(() => {
  teams.load()
})

// ---------- 创建 ----------

const showCreate = ref(false)
const createName = ref('')
const createMe = ref('')
const creating = ref(false)

function openCreate() {
  createName.value = ''
  createMe.value = ''
  showCreate.value = true
}

async function submitCreate() {
  const name = createName.value.trim()
  const me = createMe.value.trim() || '我'
  if (!name) {
    message.error('请填写团队名称')
    return
  }
  creating.value = true
  try {
    const t = await teams.create(name, me)
    showCreate.value = false
    message.success(`已创建「${t.name}」`)
    void router.push(`/team/${t.teamId}`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    creating.value = false
  }
}

// ---------- 加入 ----------

const showJoin = ref(false)
const showScanner = ref(false)
const joinCode = ref('')
const joinName = ref('')
const joining = ref(false)

function openJoin() {
  joinCode.value = ''
  joinName.value = ''
  showJoin.value = true
}

const scannedTeamName = computed(() => {
  try {
    return parseHostTicket(joinCode.value).teamName || '（未命名团队）'
  } catch {
    return ''
  }
})

async function doJoin() {
  const code = joinCode.value.trim()
  const me = joinName.value.trim()
  if (!code) {
    message.error('请扫码或粘贴会话码')
    return
  }
  if (!me) {
    message.error('请填写你在团队里的名字')
    return
  }
  joining.value = true
  try {
    const existing = teams.teamList.find((t) => {
      try {
        return parseHostTicket(code).teamId === t.teamId
      } catch {
        return false
      }
    })
    const res = await joinTeam({
      ticketText: code,
      memberName: me,
      existingLink: existing ? (teams.links[existing.teamId] ?? undefined) ?? undefined : undefined,
    })
    if (!res.ok) {
      message.error(res.error)
      return
    }
    showJoin.value = false
    await teams.load()
    message.success(`已加入「${res.teamName || '团队'}」`)
    void router.push(`/team/${res.link.teamId}`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    joining.value = false
  }
}

function onScanned(text: string) {
  showScanner.value = false
  joinCode.value = text
}

function onScanError(msg: string) {
  showScanner.value = false
  message.error(`扫码失败：${msg}（可改用手动粘贴会话码）`)
}

// ---------- 展示 ----------

function myRole(t: TeamListItem): string {
  const me = t.roster.find((m) => m.memberId === t.myMemberId)
  return me?.role === 'organizer' ? '组织者' : '成员'
}

function goTeam(t: TeamListItem) {
  void router.push(`/team/${t.teamId}`)
}

const deletingTeamId = ref<string | null>(null)

async function removeTeam(t: TeamListItem) {
  if (currentTeamSession()?.teamId === t.teamId) {
    await stopTeamHost().catch(() => {})
  }
  deletingTeamId.value = t.teamId
  try {
    await teams.remove(t.teamId)
    message.success(`已删除「${t.name}」`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    deletingTeamId.value = null
  }
}
</script>

<template>
  <div class="page">
    <UiPageHeader title="团队筹备" subtitle="分工、采购、清点与汇总，汇总结果分发给每位成员">
      <n-button @click="openJoin">
        <template #icon><ScanLine :size="16" /></template>
        扫码加入
      </n-button>
      <n-button type="primary" @click="openCreate">
        <template #icon><Plus :size="16" /></template>
        创建团队
      </n-button>
    </UiPageHeader>

    <UiEmptyState
      v-if="teams.loaded && teams.teamList.length === 0"
      title="还没有团队"
      description="自己组织旅行时创建一个团队；收到组织者的会话码就扫码加入。"
    />

    <div v-else class="grid">
      <div v-for="t in teams.teamList" :key="t.teamId" class="card-wrap">
        <button class="card" @click="goTeam(t)">
        <div class="card-head">
          <span class="card-title">{{ t.name }}</span>
          <n-tag :type="myRole(t) === '组织者' ? 'warning' : 'info'" size="small" :bordered="false">
            <template #icon>
              <Crown v-if="myRole(t) === '组织者'" :size="13" />
              <Users v-else :size="13" />
            </template>
            {{ myRole(t) }}
          </n-tag>
          </div>
          <div class="card-meta">
            <span>{{ t.roster.length }} 名成员</span>
            <span>{{ t.items.length }} 项物资</span>
            <span>{{ t.checkpoints.length }} 个节点</span>
          </div>
          <div class="card-foot">
            <ClipboardList :size="14" />
            <span v-if="t.latestPublication">已发布第 {{ t.latestPublication.version }} 版</span>
            <span v-else>尚未发布</span>
          </div>
        </button>
        <n-popconfirm @positive-click="removeTeam(t)">
          <template #trigger>
            <n-button
              class="card-delete"
              quaternary
              circle
              size="small"
              type="error"
              :loading="deletingTeamId === t.teamId"
              :aria-label="`删除团队 ${t.name}`"
            >
              <template #icon><Trash2 :size="15" /></template>
            </n-button>
          </template>
          删除「{{ t.name }}」会清掉本机的团队资料、发布记录和配对凭证，且不可恢复。确认删除？
        </n-popconfirm>
      </div>
    </div>

    <!-- 创建团队 -->
    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="创建团队"
      style="width: min(480px, calc(100vw - 32px))"
    >
      <n-form label-placement="top">
        <n-form-item label="团队名称">
          <n-input v-model:value="createName" placeholder="例如：国庆露营小队" />
        </n-form-item>
        <n-form-item label="我的名字（会显示给成员）">
          <n-input v-model:value="createMe" placeholder="例如：老张" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="submitCreate">创建</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 加入团队 -->
    <n-modal
      v-model:show="showJoin"
      preset="card"
      title="加入团队"
      style="width: min(520px, calc(100vw - 32px))"
    >
      <div v-if="showScanner" class="scanner-wrap">
        <QrScanner @scanned="onScanned" @error="onScanError" />
        <n-button size="small" @click="showScanner = false">取消扫码</n-button>
      </div>
      <div v-else class="join-body">
        <n-button v-if="canScan()" type="primary" block @click="showScanner = true">
          <template #icon><ScanLine :size="16" /></template>
          扫描组织者屏幕上的会话码
        </n-button>
        <n-input
          v-model:value="joinCode"
          type="textarea"
          :rows="2"
          placeholder="也可以把会话码粘贴到这里（knapsack-team/1?…）"
        />
        <p v-if="scannedTeamName" class="hint">识别到团队：<strong>{{ scannedTeamName }}</strong></p>
        <n-form-item label="我的名字">
          <n-input v-model:value="joinName" placeholder="例如：小李" />
        </n-form-item>
        <p class="hint">提交后需要组织者在主机上点「通过」，你才能拿到团队资料。</p>
      </div>
      <template #footer>
        <div class="modal-foot">
          <n-button @click="showJoin = false">取消</n-button>
          <n-button type="primary" :loading="joining" :disabled="showScanner" @click="doJoin">
            提交申请
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.page {
  padding: var(--space-6);
  max-width: 1100px;
  margin: 0 auto;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}

.card-wrap {
  position: relative;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-card-bg, var(--app-bg));
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}

.card:hover {
  border-color: var(--app-accent);
  transform: translateY(-1px);
}

.card-delete {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.card-title {
  font-size: var(--text-lg);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  color: var(--app-muted);
  font-size: var(--text-sm);
}

.card-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--app-muted-soft);
  font-size: var(--text-xs);
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.join-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.scanner-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hint {
  margin: 0;
  color: var(--app-muted-soft);
  font-size: var(--text-xs);
}
</style>
