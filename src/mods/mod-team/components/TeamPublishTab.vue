<script setup lang="ts">
/**
 * 主机 · 会话与发布：
 * - 开启前台会话并出示二维码（成员扫码加入/领取）
 * - 发布预览 + 发布不可变版本
 * - 分发状态：谁已领取最新版（来自主机幂等表中的回执记录）
 * 会话关闭/离开页面即停止接入；第一版不做后台常驻（SPEC 7.3）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NDropdown, NSelect, NTag, useMessage } from 'naive-ui'
import QRCode from 'qrcode'
import { Play, Square, Send, MoreHorizontal } from '@lucide/vue'
import { startTeamHost, stopTeamHost, currentTeamSession } from '../domain/teamHostService'
import { publishSnapshot, getTeam, latestPublicationOf } from '../db/actions'
import { fenToYuan } from '../../../utils/money'
import { buildPublicSnapshot } from '../domain/domain'
import { serializePublicFile, publicFileName } from '../domain/teamFile'
import { saveTextFile } from '../../../utils/fileBridge'
import { db } from '../../../db'
import type { TeamState } from '../domain/schema'

const props = defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const message = useMessage()

// ---------- 会话 ----------

const session = ref(currentTeamSession())
const qrUrl = ref('')
const starting = ref(false)
const selectedIp = ref('')

const ipOptions = computed(() =>
  (session.value?.ips ?? []).map((ip) => ({ label: ip, value: ip })),
)

async function start() {
  starting.value = true
  try {
    // 用最新持久化状态启动，避免把响应式代理带进原生层
    const fresh = (await getTeam(props.team.teamId)) ?? props.team
    const s = await startTeamHost(JSON.parse(JSON.stringify(fresh)) as TeamState, selectedIp.value || undefined)
    session.value = s
    selectedIp.value = s.ips[0] ?? ''
    await refreshQr()
    message.success(`会话已开启，等待成员接入（${s.port}）`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    starting.value = false
  }
}

/** 重画二维码。自增序号丢弃过期结果，避免并发生成时旧 dataURL 覆盖新地址。 */
let qrSeq = 0

async function refreshQr() {
  if (!session.value) return
  const seq = ++qrSeq
  const url = await QRCode.toDataURL(session.value.ticket, {
    width: 300,
    margin: 1,
    errorCorrectionLevel: 'M',
  })
  if (seq !== qrSeq) return
  qrUrl.value = url
}

async function stop() {
  await stopTeamHost().catch(() => {})
  session.value = null
  qrUrl.value = ''
}

/** 切换网卡互斥锁：两次并发 switchIp 会 stop/start 交错，底层状态不一致 */
const switching = ref(false)

async function switchIp(ip: string) {
  if (switching.value) return
  switching.value = true
  try {
    const previous = selectedIp.value
    selectedIp.value = ip
    // 换网卡需重开会话：二维码里的地址必须与监听地址一致
    await stop()
    await start()
    // 新地址起不来时回退到原地址再试一次，别把用户留在「没有会话也没有二维码」的状态
    if (!session.value && previous && previous !== ip) {
      selectedIp.value = previous
      await start()
    }
  } finally {
    switching.value = false
  }
}

async function copyTicket() {
  if (!session.value) return
  try {
    await navigator.clipboard.writeText(session.value.ticket)
    message.success('会话码已复制')
  } catch {
    message.warning('复制失败，请手动长按选中')
  }
}

// ---------- 发布 ----------

// 预览摘要必须可复现：时间戳一旦参与摘要，主机的“预览后未变化”校验会永远失败。
const preview = computed(() => buildPublicSnapshot(props.team, 'preview', 0, 0))
const publishing = ref(false)

async function publish() {
  const organizerId = props.team.myMemberId
  if (!organizerId) return
  // 细节 A：发布说明（Release Note），非必填，最多 500 字，随快照落库
  const note = window.prompt('发布说明（可选，最多 500 字，会写入快照并展示给成员）', '')
  if (note === null) return // 用户取消
  const releaseNote = note.trim().slice(0, 500)
  const previewForPublish = buildPublicSnapshot(props.team, 'preview', 0, 0, releaseNote)
  publishing.value = true
  try {
    const res = await publishSnapshot({
      teamId: props.team.teamId,
      organizerMemberId: organizerId,
      operationId: `publish-${props.team.teamId}-${props.team.draftRevision}-${previewForPublish.digest}`,
      expectedDraftRevision: props.team.draftRevision,
      // 把用户看到的预览摘要带给主机：预览之后若有人确认/退回报告或审批加入，
      // 实际快照会与预览不一致，发布被拒绝并要求重看（SPEC 4.2）。
      expectedPreviewDigest: previewForPublish.digest,
      releaseNote,
    })
    if (!res.ok) {
      message.error(res.error)
      return
    }
    message.success(`已发布第 ${res.version} 版，成员可扫码领取`)
    emit('changed')
    await loadReceipts()
  } finally {
    publishing.value = false
  }
}

// ---------- 「更多」折叠菜单（细节 C） ----------
const moreOptions = [
  { label: '导出资料文件', key: 'export-public' },
]
function onMoreSelect(key: string) {
  if (key === 'export-public') void exportPublic()
}
// ---------- 导出公共资料文件（离线兜底） ----------

const exporting = ref(false)

async function exportPublic() {
  const snap = await latestPublicationOf(props.team.teamId)
  if (!snap) {
    message.warning('还没有发布过，无法导出')
    return
  }
  exporting.value = true
  try {
    const text = serializePublicFile(snap)
    const res = await saveTextFile(publicFileName(props.team.name, snap.version), text)
    if (!res.ok) {
      message.error(res.error ?? '导出失败')
      return
    }
    if (res.warning) message.warning(`已写入文件，但分享未完成：${res.warning}`)
    else message.success(`已导出第 ${snap.version} 版公共资料文件`)
  } finally {
    exporting.value = false
  }
}

// ---------- 分发状态 ----------

const receipts = ref<Record<string, number>>({})

async function loadReceipts() {
  const rows = await db.teamIdempotency.where('teamId').equals(props.team.teamId).toArray()
  const map: Record<string, number> = {}
  for (const r of rows) {
    if (r.action !== 'receipt.submit') continue
    const res = r.result as { ok?: boolean; latestVersion?: number }
    if (res?.ok && typeof res.latestVersion === 'number') {
      map[r.actorMemberId] = Math.max(map[r.actorMemberId] ?? 0, res.latestVersion)
    }
  }
  receipts.value = map
}

// 挂载时加载，teamId 变化（详情页复用组件）时重载
onMounted(() => void loadReceipts())
watch(
  () => props.team.teamId,
  () => void loadReceipts(),
)

const latestVersion = computed(() => props.team.latestPublication?.version ?? 0)

function memberName(memberId: string): string {
  return props.team.roster.find((m) => m.memberId === memberId)?.name ?? memberId.slice(0, 6)
}

onBeforeUnmount(() => {
  // 离开页面即停止接入（前台会话语义）
  if (currentTeamSession()) void stopTeamHost().catch(() => {})
})
</script>

<template>
  <div class="wrap">
    <!-- 会话 -->
    <n-card title="汇总会话（成员扫码接入）" size="small">
      <template #header-extra>
        <n-button v-if="!session" type="primary" size="small" :loading="starting" @click="start">
          <template #icon><Play :size="14" /></template>
          开启会话
        </n-button>
        <n-button v-else size="small" type="warning" @click="stop">
          <template #icon><Square :size="14" /></template>
          停止
        </n-button>
      </template>

      <div v-if="!session" class="muted small">
        只有 Android 应用内能当汇总主机。开启后请保持本页在前台，锁屏或退出会停止接入。
      </div>

      <div v-else class="session-wrap">
        <img v-if="qrUrl" :src="qrUrl" class="qr" alt="团队会话二维码" />
        <div class="session-side">
          <div class="kv">
            <span class="muted">地址</span>
            <n-select
              v-if="ipOptions.length > 1"
              :value="selectedIp"
              size="small"
              :options="ipOptions"
              class="ip-select"
              @update:value="switchIp"
            />
            <code v-else>{{ selectedIp || session.ips[0] }}:{{ session.port }}</code>
          </div>
          <div v-if="ipOptions.length > 1" class="kv">
            <span class="muted">端口</span><code>{{ session.port }}</code>
          </div>
          <p class="muted small">
            会话码只含本次会话的临时公钥，成员各自与主机协商独立密钥，成员之间互不可解密。
          </p>
          <n-button size="small" @click="copyTicket">复制会话码</n-button>
        </div>
      </div>
    </n-card>

    <!-- 发布 -->
    <n-card title="发布公共版本" size="small">
      <template #header-extra>
        <div class="head-actions">
          <n-button type="primary" size="small" :loading="publishing" @click="publish">
            <template #icon><Send :size="14" /></template>
            发布第 {{ latestVersion + 1 }} 版
          </n-button>
        </div>
          <!-- 细节 C：低频文件导出收进「更多」（发布卡片始终可见，不受会话开关影响） -->
          <n-dropdown trigger="click" :options="moreOptions" @select="onMoreSelect">
            <n-button size="small" tertiary>
              <template #icon><MoreHorizontal :size="14" /></template>
              更多
            </n-button>
          </n-dropdown>
      </template>

      <n-alert v-if="team.roster.length === 0" type="warning" :show-icon="false" class="tip">
        名册为空，先让成员加入再发布。
      </n-alert>

      <div class="preview">
        <div class="preview-row"><span class="muted">成员</span><span>{{ preview.roster.length }} 人</span></div>
        <div class="preview-row"><span class="muted">物资</span><span>{{ preview.items.length }} 项</span></div>
        <div class="preview-row">
          <span class="muted">已确认费用</span>
          <span>{{ fenToYuan(preview.expenses.reduce((a, e) => a + e.amountFen, 0)) }} 元</span>
        </div>
        <div class="preview-row"><span class="muted">清点节点</span><span>{{ preview.checkpoints.length }} 个</span></div>
      </div>

      <p class="muted small">
        发布的是不可变快照：发布后再改草稿不会影响已发布版本，历史版本保持原样。
        公共快照只含团队资料与我的任务，不含任何私人行程、行李、备忘或凭证。
        成员连不上网络时，可把最新版导出成资料文件发给对方导入（文件不证明身份，导入前会显示来源与版本）。
      </p>
    </n-card>

    <!-- 分发状态 -->
    <n-card title="分发状态" size="small">
      <p v-if="latestVersion === 0" class="muted small">还没有发布过。</p>
      <template v-else>
        <div v-for="m in team.roster" :key="m.memberId" class="row">
          <span class="grow">{{ memberName(m.memberId) }}</span>
          <n-tag
            size="small"
            :type="(receipts[m.memberId] ?? 0) >= latestVersion ? 'success' : 'default'"
            :bordered="false"
          >
            <template v-if="(receipts[m.memberId] ?? 0) >= latestVersion">已领取第 {{ latestVersion }} 版</template>
            <template v-else-if="receipts[m.memberId]">领取到第 {{ receipts[m.memberId] }} 版，待更新</template>
            <template v-else>尚未领取</template>
          </n-tag>
        </div>
      </template>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.session-wrap {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}

.qr {
  width: 220px;
  height: 220px;
  image-rendering: pixelated;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  flex-shrink: 0;
}

.session-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.kv {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.kv code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--app-chip-bg);
  padding: 2px 6px;
  border-radius: 4px;
}

.ip-select {
  min-width: 170px;
}

.preview {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-bottom: var(--space-2);
}

.head-actions {
  display: flex;
  gap: var(--space-2);
}

.preview-row {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--app-border);
}

.grow {
  flex: 1;
  min-width: 0;
}

.tip {
  margin-bottom: var(--space-3);
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: var(--text-xs);
}

@media (max-width: 720px) {
  .session-wrap {
    flex-direction: column;
    align-items: center;
  }
}
</style>
