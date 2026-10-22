<script setup lang="ts">
/**
 * 成员视图：连接主机、我的任务、上报、领取最新公共版本。
 * 领取时「保存快照 + 更新指针 + 回执 outbox」在同一事务完成，事务成功后才发回执（SPEC 4.3）。
 */
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NInput,
  NInputNumber,
  NSelect,
  NTag,
  NModal,
  NForm,
  NFormItem,
  NAlert,
  useMessage,
} from 'naive-ui'
import { Plug, RefreshCw, Upload, Download, ScanLine, FileDown, FileUp } from '@lucide/vue'
import { useTeamsStore } from '../../stores/teams'
import {
  connectAsMember,
  fetchLatestPublication,
  submitReport,
  sendReceipt,
  type MemberSession,
} from '../../team/teamClient'
import { ingestPublication, clearOutbox, pendingOutbox, getTeam, latestPublicationOf } from '../../db/teamActions'
import { serializeSubmissionFile, submissionFileName, checkPublicImport, type PublicImportCheck } from '../../team/teamFile'
import { saveTextFile, pickTextFile } from '../../utils/fileBridge'
import { canScan } from '../../utils/lanSessionScan'
import QrScanner from '../QrScanner.vue'
import { newId } from '../../team/protocol'
import { yuanToFen } from '../../utils/money'
import type { TeamState, PublicSnapshot } from '../../team/schema'

const props = defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const teams = useTeamsStore()
const message = useMessage()

const session = ref<MemberSession | null>(null)
const connecting = ref(false)
const ticket = ref('')
const showScanner = ref(false)
const snapshot = ref<PublicSnapshot | null>(null)
const pendingCount = ref(0)

const me = computed(() => props.team.roster.find((m) => m.memberId === props.team.myMemberId))
const localVersion = computed(() => props.team.latestPublication?.version ?? 0)

onMounted(async () => {
  snapshot.value = (await latestPublicationOf(props.team.teamId)) ?? null
  pendingCount.value = (await pendingOutbox(props.team.teamId)).length
})

// ---------- 连接 ----------

async function connect(code?: string) {
  const text = (code ?? ticket.value).trim()
  if (!text) {
    message.error('请扫码或粘贴组织者给的会话码')
    return
  }
  connecting.value = true
  try {
    session.value = await connectAsMember(text)
    ticket.value = text
    message.success('已连上组织者主机')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    connecting.value = false
  }
}

function onScanned(text: string) {
  showScanner.value = false
  void connect(text)
}

function onScanError(msg: string) {
  showScanner.value = false
  message.error(`扫码失败：${msg}（可改用手动粘贴会话码）`)
}

// ---------- 领取 ----------

const claiming = ref(false)

async function claim() {
  if (!session.value) {
    message.error('请先连接组织者主机')
    return
  }
  claiming.value = true
  try {
    const snap = await fetchLatestPublication(session.value)
    if (!snap) {
      message.warning('组织者还没有发布任何版本')
      return
    }
    const opId = `receipt-${snap.publicationId}-${newId()}`
    const saved = await ingestPublication({
      teamId: props.team.teamId,
      memberId: props.team.myMemberId ?? '',
      snapshot: snap,
      operationId: opId,
    })
    if (!saved.ok) {
      message.error(saved.error)
      return
    }
    snapshot.value = snap
    // 事务已成功：此时才发回执；失败则保留在 outbox 待补传
    try {
      const r = await sendReceipt(session.value, snap.publicationId, snap.version, opId)
      if (r.ok) {
        await clearOutbox(opId)
        message.success(`已领取第 ${snap.version} 版，回执已送达`)
      } else {
        message.warning(`已保存第 ${snap.version} 版，回执待补传（${r.error}）`)
      }
    } catch (e) {
      message.warning(`已保存第 ${snap.version} 版，回执待补传：${e instanceof Error ? e.message : String(e)}`)
    }
    pendingCount.value = (await pendingOutbox(props.team.teamId)).length
    emit('changed')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    claiming.value = false
  }
}

// ---------- 我的任务 ----------

const myAssignments = computed(() => {
  const mid = props.team.myMemberId
  if (!mid || !snapshot.value) return []
  return snapshot.value.assignments.filter((a) => a.memberId === mid)
})

function itemOf(allocationId: string) {
  for (const it of snapshot.value?.items ?? []) {
    const a = it.allocations.find((x) => x.allocationId === allocationId)
    if (a) return { item: it, allocation: a }
  }
  return null
}

const stageLabel: Record<string, string> = { purchase: '采购', carry: '携带', count: '清点' }

// ---------- 上报 ----------

const showReport = ref(false)
const reportForm = ref({
  allocationId: '',
  stage: 'purchase' as 'purchase' | 'carry' | 'count',
  checkpointId: null as string | null,
  qty: 1,
  amountYuan: '' as string,
  note: '',
})
const submitting = ref(false)

function openReport() {
  const first = myAssignments.value[0]
  resetReportForm(first)
  showReport.value = true
}

/** 打开或提交后都走这里：默认选中第一个任务，其余字段清空。
 *  提交后不重置的话，下次打开会残留上次的批次/数量/金额，容易误重复上报。 */
function resetReportForm(first?: { allocationId: string; stages: string[] }) {
  reportForm.value = {
    allocationId: first?.allocationId ?? '',
    stage: (first?.stages[0] as 'purchase' | 'carry' | 'count') ?? 'purchase',
    checkpointId: null,
    qty: 1,
    amountYuan: '',
    note: '',
  }
}

const reportAllocOptions = computed(() =>
  myAssignments.value.map((a) => {
    const found = itemOf(a.allocationId)
    return { label: found ? `${found.item.name}（${a.stages.map((s) => stageLabel[s]).join('/')}）` : a.allocationId, value: a.allocationId }
  }),
)

async function submit() {
  if (!session.value) {
    message.error('请先连接组织者主机')
    return
  }
  const f = reportForm.value
  if (!f.allocationId) {
    message.error('请选择要上报的批次')
    return
  }
  if (f.stage === 'count' && !f.checkpointId) {
    message.error('清点必须选择节点')
    return
  }
  submitting.value = true
  try {
    // 金额一律走 money 工具：整数分，拒绝 NaN / 三位小数 / 非法字符
    const amountFen = f.amountYuan.trim() ? yuanToFen(f.amountYuan) : null
    if (f.amountYuan.trim() && amountFen === null) {
      message.error('金额格式不对：请填两位小数以内的数字，例如 36.00')
      return
    }
    const draft = {
      submissionId: newId(),
      revision: 1,
      allocationId: f.allocationId,
      stage: f.stage,
      checkpointId: f.stage === 'count' ? f.checkpointId : null,
      // 任务版本：优先用领取到的公共快照所依据的草稿版本；
      // 还没领取过快照时退回本机 teamState 的 draftRevision。
      // 不能再写死 1——那会让报告在组织者一改分工后就立刻被判 stale。
      taskRevision: snapshot.value?.sourceDraftRevision ?? props.team.draftRevision,
      qty: f.qty,
      amountFen,
      expenseReportId: amountFen !== null ? newId() : null,
      payerMemberId: null,
      relatedAllocationIds: [f.allocationId],
      note: f.note.trim(),
    }
    const res = await submitReport(session.value, draft, `submit-${draft.submissionId}`)
    if (!res.ok) {
      message.error(res.error ?? '上报失败')
      return
    }
    showReport.value = false
    resetReportForm()
    message.success('已上报，等待组织者确认')
  } finally {
    submitting.value = false
  }
}

const checkpointOptions = computed(() =>
  (snapshot.value?.checkpoints ?? []).map((c) => ({ label: c.name, value: c.checkpointId })),
)

// ---------- 文件兜底（离线传递） ----------

const exporting = ref(false)

async function exportMyReports() {
  const mid = props.team.myMemberId
  if (!mid) {
    message.error('本机还没有绑定成员身份')
    return
  }
  // 只导出还有效的报告：stale/withdrawn 的内容已过时，组织者导入后
  // 会占用审核列表还可能被误确认。confirmed/rejected 属于历史结论，
  // 主机端按幂等键判重后不会产生副作用，一并带上便于对账。
  const mine = props.team.submissions.filter(
    (s) => s.authorMemberId === mid && s.review !== 'stale' && s.review !== 'withdrawn',
  )
  if (mine.length === 0) {
    message.warning('还没有可导出的报告')
    return
  }
  exporting.value = true
  try {
    const text = serializeSubmissionFile(props.team.teamId, mine, me.value?.name ?? '')
    const res = await saveTextFile(submissionFileName(props.team.name, me.value?.name ?? '成员'), text)
    if (!res.ok) {
      message.error(res.error ?? '导出失败')
      return
    }
    if (res.warning) message.warning(`已写入文件，但分享未完成：${res.warning}`)
    else message.success(`已导出 ${mine.length} 条报告，交给组织者导入`)
  } finally {
    exporting.value = false
  }
}

const importPreview = ref<PublicImportCheck | null>(null)
const importFileName = ref('')
const importing = ref(false)

const comparisonText = computed(() => {
  const c = importPreview.value?.comparison
  if (c === 'newer') return '比本机版本新，可导入'
  if (c === 'same') return '与本机版本相同'
  if (c === 'older') return '比本机版本旧，导入不会降级'
  return '本机还没有版本记录，无法比较新旧'
})

async function pickPublicFile() {
  const picked = await pickTextFile('.team-public,application/json')
  if (!picked) return
  try {
    const check = checkPublicImport(picked.text, localVersion.value)
    if (check.snapshot.teamId !== props.team.teamId) {
      message.error('这个文件属于另一个团队，已拒绝导入')
      return
    }
    if (!check.digestOk) {
      message.error('文件校验和不一致，可能已损坏，已拒绝导入')
      return
    }
    importFileName.value = picked.name
    importPreview.value = check
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function confirmImport() {
  const check = importPreview.value
  if (!check) return
  importing.value = true
  try {
    const res = await ingestPublication({
      teamId: props.team.teamId,
      memberId: props.team.myMemberId ?? '',
      snapshot: check.snapshot,
      operationId: `file-import-${check.snapshot.publicationId}-${newId()}`,
      // 文件不证明在线身份：只更新本机团队视图，不入队回执
      queueReceipt: false,
    })
    if (!res.ok) {
      message.error(res.error)
      return
    }
    snapshot.value = check.snapshot
    importPreview.value = null
    message.success(`已导入第 ${check.snapshot.version} 版（来源文件：${importFileName.value}）`)
    emit('changed')
  } finally {
    importing.value = false
  }
}

async function refresh() {
  await teams.refresh(props.team.teamId)
  const t = await getTeam(props.team.teamId)
  if (t) teams.teams.splice(teams.teams.findIndex((x) => x.teamId === t.teamId), 1, t)
  emit('changed')
}
</script>

<template>
  <div class="wrap">
    <!-- 连接 -->
    <n-card title="连接组织者" size="small">
      <template #header-extra>
        <n-tag v-if="session" size="small" type="success" :bordered="false">已连接</n-tag>
      </template>

      <div v-if="showScanner" class="scanner-wrap">
        <QrScanner @scanned="onScanned" @error="onScanError" />
        <n-button size="small" @click="showScanner = false">取消扫码</n-button>
      </div>

      <template v-else>
        <n-button v-if="canScan()" class="scan-btn" @click="showScanner = true">
          <template #icon><ScanLine :size="16" /></template>
          扫描组织者屏幕上的会话码
        </n-button>
        <n-input
          v-model:value="ticket"
          type="textarea"
          :rows="2"
          class="code-input"
          placeholder="或把组织者的会话码粘贴到这里（knapsack-team/1?…）"
        />
        <div class="row">
          <n-button :loading="connecting" :disabled="!ticket.trim()" @click="connect()">
            <template #icon><Plug :size="14" /></template>
            连接
          </n-button>
          <n-button v-if="session" @click="refresh">
            <template #icon><RefreshCw :size="14" /></template>
            刷新状态
          </n-button>
        </div>
        <p class="muted small">
          我：{{ me?.name ?? '（未绑定）' }} · 本机持有第 {{ localVersion }} 版
          <span v-if="pendingCount > 0"> · {{ pendingCount }} 条回执待补传</span>
        </p>
      </template>
    </n-card>

    <!-- 领取 -->
    <n-card title="领取公共版本" size="small">
      <template #header-extra>
        <div class="head-actions">
          <n-button size="small" @click="pickPublicFile">
            <template #icon><FileUp :size="14" /></template>
            导入文件
          </n-button>
          <n-button type="primary" size="small" :loading="claiming" @click="claim">
            <template #icon><Download :size="14" /></template>
            领取最新版
          </n-button>
        </div>
      </template>
      <p v-if="snapshot" class="muted small">
        本机保存：第 {{ snapshot.version }} 版（{{ snapshot.roster.length }} 名成员、{{ snapshot.items.length }} 项物资）
      </p>
      <p v-else class="muted small">还没有领取过任何版本。</p>
      <p class="muted small">
        领取只保存团队公共资料与我的任务；你的私人行李、备忘和未上传草稿不受影响。
        连不上组织者时，可用对方给的资料文件导入（文件不证明身份，只更新本机团队视图）。
      </p>
    </n-card>

    <!-- 我的任务 -->
    <n-card title="我的任务" size="small">
      <template #header-extra>
        <div class="head-actions">
          <n-button size="small" :loading="exporting" @click="exportMyReports">
            <template #icon><FileDown :size="14" /></template>
            导出报告
          </n-button>
          <n-button size="small" :disabled="myAssignments.length === 0" @click="openReport">
            <template #icon><Upload :size="14" /></template>
            上报
          </n-button>
        </div>
      </template>
      <p v-if="myAssignments.length === 0" class="muted small">
        还没有分配给你的任务，或还没领取最新版。
      </p>
      <div v-for="a in myAssignments" :key="a.allocationId" class="row task-row">
        <span class="grow">
          <strong>{{ itemOf(a.allocationId)?.item.name ?? a.allocationId }}</strong>
          <span class="muted small">
            · 计划 {{ itemOf(a.allocationId)?.allocation.qtyPlanned }}
            {{ itemOf(a.allocationId)?.item.unit }}
          </span>
        </span>
        <n-tag v-for="s in a.stages" :key="s" size="tiny" :bordered="false">{{ stageLabel[s] }}</n-tag>
      </div>
    </n-card>

    <!-- 上报 -->
    <n-modal v-model:show="showReport" preset="card" title="上报" style="width: min(480px, calc(100vw - 32px))">
      <n-form label-placement="top">
        <n-form-item label="批次">
          <n-select v-model:value="reportForm.allocationId" :options="reportAllocOptions" placeholder="选择批次" />
        </n-form-item>
        <n-form-item label="环节">
          <n-select
            v-model:value="reportForm.stage"
            :options="[
              { label: '采购', value: 'purchase' },
              { label: '携带', value: 'carry' },
              { label: '清点', value: 'count' },
            ]"
          />
        </n-form-item>
        <n-form-item v-if="reportForm.stage === 'count'" label="清点节点">
          <n-select v-model:value="reportForm.checkpointId" :options="checkpointOptions" placeholder="选择节点" />
        </n-form-item>
        <n-form-item label="数量">
          <n-input-number v-model:value="reportForm.qty" :min="0" />
        </n-form-item>
        <n-form-item label="花费（元，可选）">
          <n-input v-model:value="reportForm.amountYuan" placeholder="例如 36.00" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="reportForm.note" type="textarea" :rows="2" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="foot">
          <n-button @click="showReport = false">取消</n-button>
          <n-button type="primary" :loading="submitting" @click="submit">提交</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 导入公共文件预览 -->
    <n-modal
      :show="!!importPreview"
      preset="card"
      title="导入公共资料文件"
      style="width: min(480px, calc(100vw - 32px))"
      @update:show="(v: boolean) => { if (!v) importPreview = null }"
    >
      <template v-if="importPreview">
        <n-alert type="warning" :show-icon="false" class="tip">
          文件不证明身份，请先核对来源再导入。
        </n-alert>
        <div class="kv"><span class="muted">来源文件</span><span>{{ importFileName }}</span></div>
        <div class="kv"><span class="muted">团队</span><span>{{ props.team.name }}</span></div>
        <div class="kv"><span class="muted">版本</span><span>第 {{ importPreview.snapshot.version }} 版</span></div>
        <div class="kv"><span class="muted">校验和</span><span>一致</span></div>
        <div class="kv"><span class="muted">对比</span><span>{{ comparisonText }}</span></div>
        <p class="muted small">
          导入只更新本机团队公共视图与我的任务，不改动你的私人行程/行李/备忘，也不会向组织者回执。
        </p>
      </template>
      <template #footer>
        <div class="foot">
          <n-button @click="importPreview = null">取消</n-button>
          <n-button type="primary" :loading="importing" @click="confirmImport">导入</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.grow {
  flex: 1;
  min-width: 0;
}

.task-row {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--app-border);
}

.scan-btn {
  width: 100%;
  margin-bottom: var(--space-2);
}

.code-input {
  margin-bottom: var(--space-2);
}

.scanner-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: var(--text-xs);
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.head-actions {
  display: flex;
  gap: var(--space-2);
}

.kv {
  display: flex;
  gap: var(--space-3);
  padding: 2px 0;
  font-size: var(--text-sm);
}

.kv > .muted {
  min-width: 64px;
}

.tip {
  margin-bottom: var(--space-3);
}
</style>
