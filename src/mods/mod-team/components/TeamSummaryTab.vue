<script setup lang="ts">
/**
 * 主机 · 汇总与确认：待审核报告、缺口总表。
 * 只有组织者确认后，数量/费用才进入「当前确认量」；未确认不伪装成事实（SPEC 3.4/3.3）。
 */
import { computed, ref, reactive } from 'vue'
import { NAlert, NButton, NCard, NDropdown, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { Check, X, MoreHorizontal } from '@lucide/vue'
import { acceptSubmission, decideSubmission } from '../db/actions'
import { currentConfirmedQty, digestOf, summarizeAllocation } from '../domain/domain'
import { confirmKeyString, newId } from '../domain/protocol'
import { dedupeSubmissions, parseSubmissionFile } from '../domain/teamFile'
import { pickTextFile } from '../../../utils/fileBridge'
import { fenToYuan } from '../../../utils/money'
import type { TeamState, Submission } from '../domain/schema'

const props = defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const message = useMessage()

const stageLabel: Record<string, string> = {
  purchase: '采购',
  carry: '携带',
  count: '清点',
}

/**
 * 待审核报告。同 submissionId 存在更早 revision 时，附带旧版数据用于
 * 「已修订」角标与前后对比（细节 B）。
 */
const pending = computed(() =>
  props.team.submissions
    // 同 submissionId 已有更高 revision 在待审/已确认时，旧行不重复占位——
    // 它的信息由新版的「已修订」角标与对比区承载（细节 B）
    .filter(
      (s) =>
        s.review === 'submitted' &&
        !props.team.submissions.some(
          (o) =>
            o.submissionId === s.submissionId &&
            o.revision > s.revision &&
            (o.review === 'submitted' || o.review === 'confirmed'),
        ),
    )
    .map((s) => {
      const older = props.team.submissions
        .filter((o) => o.submissionId === s.submissionId && o.revision < s.revision)
        .sort((a, b) => b.revision - a.revision)
      return { sub: s, prev: older[0] ?? null }
    }),
)
/** 展开状态：记录正在对比的 submissionId */
const diffOpen = reactive<Record<string, boolean>>({})
function toggleDiff(submissionId: string) {
  diffOpen[submissionId] = !diffOpen[submissionId]
}
/** 前后数值差异描述：只列真正变了的字段（细节 B） */
function diffText(a: Submission, b: Submission): string[] {
  const out: string[] = []
  if (a.qty !== b.qty) out.push(`数量 ${a.qty ?? '—'} → ${b.qty ?? '—'}`)
  if (a.amountFen !== b.amountFen) {
    out.push(`金额 ${a.amountFen !== null ? fenToYuan(a.amountFen) : '—'} → ${b.amountFen !== null ? fenToYuan(b.amountFen) : '—'} 元`)
  }
  if (a.note !== b.note) out.push(`备注「${a.note || '（空）'}」→「${b.note || '（空）'}」`)
  return out
}

function memberName(memberId: string): string {
  return props.team.roster.find((m) => m.memberId === memberId)?.name ?? '（已移除成员）'
}

function itemName(allocationId: string | null): string {
  if (!allocationId) return '—'
  const a = props.team.allocations.find((x) => x.allocationId === allocationId)
  if (!a) return '（已删除批次）'
  return props.team.items.find((i) => i.itemId === a.itemId)?.name ?? '（已删除物资）'
}

function checkpointName(checkpointId: string | null): string {
  if (!checkpointId) return '—'
  return props.team.checkpoints.find((c) => c.checkpointId === checkpointId)?.name ?? '（已删除节点）'
}

function describe(s: Submission): string {
  if (s.amountFen !== null) return `${fenToYuan(s.amountFen)} 元`
  if (s.qty !== null) return `${s.qty}`
  return '—'
}

// ---------- 确认 / 退回 ----------

const rejecting = ref<Submission | null>(null)
const rejectNote = ref('')

/** 正在处理的报告：防双击重复提交，也避免两击间状态变化导致意外 stale */
const confirmingId = ref<string | null>(null)

async function confirm(s: Submission) {
  const organizerId = props.team.myMemberId
  if (!organizerId) return
  if (confirmingId.value) return
  confirmingId.value = s.submissionId
  try {
    const res = await decideSubmission({
      teamId: props.team.teamId,
      organizerMemberId: organizerId,
      // operationId 含 submissionId+revision：双击时第二次会在动作层
      // 命中幂等重放，不会产生两个不同的确认动作
      operationId: `confirm-${s.submissionId}-${s.revision}`,
      submissionId: s.submissionId,
      revision: s.revision,
      decision: 'confirmed',
    })
    if (!res.ok) {
      message.error(res.error)
      return
    }
    message.success('已确认，进入当前汇总')
    emit('changed')
  } finally {
    confirmingId.value = null
  }
}

function openReject(s: Submission) {
  rejecting.value = s
  rejectNote.value = ''
}

async function submitReject() {
  const s = rejecting.value
  const organizerId = props.team.myMemberId
  if (!s || !organizerId) return
  const res = await decideSubmission({
    teamId: props.team.teamId,
    organizerMemberId: organizerId,
    operationId: `reject-${s.submissionId}-${s.revision}-${digestOf({ note: rejectNote.value.trim() })}`,
    submissionId: s.submissionId,
    revision: s.revision,
    decision: 'rejected',
    note: rejectNote.value.trim(),
  })
  if (!res.ok) {
    message.error(res.error)
    return
  }
  rejecting.value = null
  message.success('已退回，成员可修改后重新提交')
  emit('changed')
}

// ---------- 导入报告文件（人工核对来源，A32） ----------

interface ImportRow {
  submission: Submission
  /** 组织者手动指定的真实作者；空串表示尚未指定 */
  authorMemberId: string
}

const showImport = ref(false)
const importFileName = ref('')
const importExportedBy = ref('')
const importRows = ref<ImportRow[]>([])
const importDuplicates = ref<Submission[]>([])
const importConflicts = ref<Submission[]>([])
const importing = ref(false)

const rosterOptions = computed(() =>
  props.team.roster.map((m) => ({
    label: m.role === 'organizer' ? `${m.name}（组织者）` : m.name,
    value: m.memberId,
  })),
)

/** 从报告文件里取一条 submission，构造 acceptSubmission 需要的 draft（不含主机填写字段） */
function draftOf(s: Submission) {
  return {
    submissionId: s.submissionId,
    revision: s.revision,
    teamId: s.teamId,
    allocationId: s.allocationId,
    stage: s.stage,
    checkpointId: s.checkpointId,
    taskRevision: s.taskRevision,
    qty: s.qty,
    amountFen: s.amountFen,
    expenseReportId: s.expenseReportId,
    payerMemberId: s.payerMemberId,
    relatedAllocationIds: s.relatedAllocationIds,
    note: s.note,
  }
}

async function pickReportFile() {
  const picked = await pickTextFile('.team-submit,application/json')
  if (!picked) return
  if ('error' in picked) {
    message.error(picked.error)
    return
  }
  try {
    const file = parseSubmissionFile(picked.text)
    if (file.teamId !== props.team.teamId) {
      message.error('这个报告文件属于另一个团队，已拒绝导入')
      return
    }
    const { fresh, duplicates, conflicts } = dedupeSubmissions(file.submissions, props.team.submissions)
    if (fresh.length === 0 && duplicates.length === 0 && conflicts.length === 0) {
      message.warning('文件里没有报告')
      return
    }
    importFileName.value = picked.name
    importExportedBy.value = file.exportedBy || '（未标注）'
    importRows.value = fresh.map((s) => ({ submission: s, authorMemberId: '' }))
    importDuplicates.value = duplicates
    importConflicts.value = conflicts
    showImport.value = true
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

const moreOptions = [{ label: '导入报告文件', key: 'import-report' }]
function onMoreSelect(key: string) {
  if (key === 'import-report') void pickReportFile()
}

async function confirmImport() {
  const rows = importRows.value
  if (rows.length === 0) {
    showImport.value = false
    return
  }
  if (rows.some((r) => !r.authorMemberId)) {
    message.error('请为每条报告指定真实作者后再导入')
    return
  }
  importing.value = true
  try {
    let okCount = 0
    const failed: string[] = []
    for (const r of rows) {
      const s = r.submission
      const res = await acceptSubmission({
        teamId: props.team.teamId,
        authorMemberId: r.authorMemberId,
        operationId: `file-${s.submissionId}-${s.revision}-${newId()}`,
        draft: draftOf(s),
      })
      if (res.ok) okCount++
      else failed.push(`${s.submissionId.slice(0, 6)}：${res.error}`)
    }
    showImport.value = false
    if (failed.length) message.warning(`导入 ${okCount} 条，${failed.length} 条失败：${failed[0]}`)
    else message.success(`已导入 ${okCount} 条报告，进入待审核`)
    emit('changed')
  } finally {
    importing.value = false
  }
}

// ---------- 缺口总表 ----------

const confirmed = computed(() => currentConfirmedQty(props.team.submissions))

/**
 * 缺口总表的每一行。
 *
 * 原来 counts / gap / uncounted 都是在模板里用函数现算的，每个单元格要重复
 * 遍历 submissions 与 checkpoints 好几轮（gapOf 内部又会调 confirmedCount），
 * 一次重渲染下来是几倍的无谓遍历。这里全部在 computed 里算好，
 * 模板只做纯读取——computed 依赖不变就不会重算。
 */
const rows = computed(() =>
  props.team.allocations.map((a) => {
    const item = props.team.items.find((i) => i.itemId === a.itemId)
    const summary = item
      ? summarizeAllocation(a, item, props.team.checkpoints, confirmed.value, props.team.submissions)
      : null

    const counts: Array<{ checkpointId: string; qty: number }> = []
    for (const cp of props.team.checkpoints) {
      const hit = confirmed.value.get(
        confirmKeyString({ allocationId: a.allocationId, stage: 'count', checkpointId: cp.checkpointId }),
      )
      if (hit) counts.push({ checkpointId: cp.checkpointId, qty: hit.qty })
    }

    // 缺口按选定节点算（SPEC 3.3）：默认展示「最后清点的那个节点」，
    // 但明确带出节点名；多节点时组织者看的是每节点的 gapByCheckpoint，
    // 不再把数组顺序当语义。
    const hasPending = props.team.submissions.some(
      (s) =>
        s.allocationId === a.allocationId &&
        s.stage === 'count' &&
        s.review !== 'confirmed' &&
        s.review !== 'rejected',
    )
    const gapRows = (summary?.gapByCheckpoint ?? []).map((g) => ({
      ...g,
      name: props.team.checkpoints.find((c) => c.checkpointId === g.checkpointId)?.name ?? g.checkpointId,
    }))
    const lastGap = gapRows.length > 0 ? gapRows[gapRows.length - 1]! : null
    const uncounted = hasPending || gapRows.length === 0

    return {
      allocation: a,
      item,
      summary,
      counts,
      gapRows,
      gapCheckpointName: lastGap?.name ?? null,
      gap: lastGap?.gap ?? null,
      uncounted,
      purchase: confirmed.value.get(
        confirmKeyString({ allocationId: a.allocationId, stage: 'purchase', checkpointId: null }),
      ),
      carry: confirmed.value.get(
        confirmKeyString({ allocationId: a.allocationId, stage: 'carry', checkpointId: null }),
      ),
    }
  }),
)
</script>

<template>
  <div class="wrap">
    <!-- 待审核 -->
    <n-card title="待审核报告" size="small">
      <template #header-extra>
        <n-dropdown trigger="click" :options="moreOptions" @select="onMoreSelect">
          <n-button size="small" tertiary>
            <template #icon><MoreHorizontal :size="14" /></template>
            更多
          </n-button>
        </n-dropdown>
      </template>
      <p v-if="pending.length === 0" class="muted small">暂无待审核报告。</p>
      <div v-for="r in pending" :key="`${r.sub.submissionId}-${r.sub.revision}`" class="row sub-row">
        <div class="grow">
          <div class="sub-head">
            <strong>{{ memberName(r.sub.authorMemberId) }}</strong>
            <n-tag size="tiny" :bordered="false">{{ stageLabel[r.sub.stage] ?? r.sub.stage }}</n-tag>
            <span class="muted small">{{ itemName(r.sub.allocationId) }}</span>
            <span v-if="r.sub.checkpointId" class="muted small">@ {{ checkpointName(r.sub.checkpointId) }}</span>
            <!-- 细节 B：醒目「已修订」角标 -->
            <n-tag v-if="r.prev" size="tiny" type="warning" :bordered="false" class="rev-badge">
              已修订 · 第 {{ r.sub.revision }} 版
            </n-tag>
          </div>
          <div class="sub-body">
            <span class="num">{{ describe(r.sub) }}</span>
            <span v-if="r.sub.qty !== null && r.sub.amountFen !== null" class="muted small">（数量 {{ r.sub.qty }}）</span>
            <span v-if="r.sub.note" class="muted small">备注：{{ r.sub.note }}</span>
          </div>
          <!-- 细节 B：展开对比修改前后的数值差异 -->
          <div v-if="r.prev" class="diff-area">
            <n-button text size="tiny" @click="toggleDiff(r.sub.submissionId)">
              {{ diffOpen[r.sub.submissionId] ? '收起对比' : '查看改了什么' }}
            </n-button>
            <div v-if="diffOpen[r.sub.submissionId]" class="diff-box">
              <div class="muted small">原第 {{ r.prev.revision }} 版：{{ describe(r.prev) }}</div>
              <div v-for="d in diffText(r.prev, r.sub)" :key="d" class="diff-line">• {{ d }}</div>
            </div>
          </div>
        </div>
        <n-button size="small" type="primary" @click="confirm(r.sub)">
          <template #icon><Check :size="14" /></template>
          确认
        </n-button>
        <n-button size="small" @click="openReject(r.sub)">
          <template #icon><X :size="14" /></template>
          退回
        </n-button>
      </div>
    </n-card>

    <!-- 缺口总表 -->
    <n-card title="缺口总表" size="small">
      <p v-if="rows.length === 0" class="muted small">还没有批次，先去「分工设置」添加物资与批次。</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>物资 / 批次</th>
            <th>需求</th>
            <th>采购确认</th>
            <th>携带确认</th>
            <th>清点确认</th>
            <th>缺口</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.allocation.allocationId">
            <td>
              <strong>{{ r.item?.name ?? '（已删除物资）' }}</strong>
              <span class="muted small"> / 计划 {{ r.allocation.qtyPlanned }}</span>
            </td>
            <td>{{ r.item ? `${r.item.qtyNeeded} ${r.item.unit}` : '—' }}</td>
            <td>{{ r.purchase ? r.purchase.qty : '—' }}</td>
            <td>{{ r.carry ? r.carry.qty : '—' }}</td>
            <td>
              <template v-if="r.counts.length">
                <span
                  v-for="c in r.counts"
                  :key="c.checkpointId"
                  class="count-chip"
                >
                  {{ checkpointName(c.checkpointId) }}：{{ c.qty }}
                </span>
              </template>
              <span v-else class="muted">未清点</span>
            </td>
            <td>
              <template v-if="r.item">
                <template v-if="r.uncounted">
                  <n-tag size="tiny" type="warning" :bordered="false">待核对</n-tag>
                </template>
                <template v-else>
                  <n-tag
                    size="tiny"
                    :type="(r.gap ?? 0) > 0 ? 'error' : 'success'"
                    :bordered="false"
                  >
                    缺 {{ r.gap }}<span v-if="r.gapCheckpointName" class="muted"> @{{ r.gapCheckpointName }}</span>
                  </n-tag>
                </template>
              </template>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">
        缺口按节点单独计算，不跨节点相加；有未确认清点报告时标「待核对」，不伪装成确定缺失。
      </p>
    </n-card>

    <!-- 退回原因 -->
    <n-modal
      :show="!!rejecting"
      preset="card"
      title="退回报告"
      style="width: min(440px, calc(100vw - 32px))"
      @update:show="(v: boolean) => { if (!v) rejecting = null }"
    >
      <n-input v-model:value="rejectNote" type="textarea" :rows="3" placeholder="说明哪里不对，方便对方修改" />
      <template #footer>
        <div class="foot">
          <n-button @click="rejecting = null">取消</n-button>
          <n-button type="primary" @click="submitReject">确认退回</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 导入报告文件：人工核对来源并指定作者 -->
    <n-modal
      v-model:show="showImport"
      preset="card"
      title="导入报告文件"
      style="width: min(560px, calc(100vw - 32px))"
    >
      <n-alert type="warning" :show-icon="false" class="tip">
        文件不证明身份，下面「导出方」只是对方自报，不能据此自动通过；请逐条指定真实作者。
      </n-alert>
      <div class="kv"><span class="muted">来源文件</span><span>{{ importFileName }}</span></div>
      <div class="kv"><span class="muted">导出方自报</span><span>{{ importExportedBy }}</span></div>

      <template v-if="importRows.length">
        <div class="section-title">待导入（{{ importRows.length }} 条）</div>
        <div v-for="(r, i) in importRows" :key="r.submission.submissionId + '-' + r.submission.revision" class="imp-row">
          <div class="imp-desc">
            <strong>{{ describe(r.submission) }}</strong>
            <n-tag size="tiny" :bordered="false">{{ stageLabel[r.submission.stage] ?? r.submission.stage }}</n-tag>
            <span class="muted small">{{ itemName(r.submission.allocationId) }}</span>
            <span v-if="r.submission.note" class="muted small">备注：{{ r.submission.note }}</span>
          </div>
          <n-select
            v-model:value="importRows[i]!.authorMemberId"
            size="small"
            :options="rosterOptions"
            placeholder="指定真实作者"
            class="imp-select"
          />
        </div>
      </template>

      <template v-if="importDuplicates.length">
        <div class="section-title">已存在（{{ importDuplicates.length }} 条，跳过）</div>
        <p class="muted small">同 ID 同版本且内容一致，无需重复导入。</p>
      </template>

      <template v-if="importConflicts.length">
        <div class="section-title conflict">冲突（{{ importConflicts.length }} 条，不导入）</div>
        <p class="muted small">同 ID 同版本但内容不一致，请与对方核对后再处理，不会静默覆盖。</p>
      </template>

      <template #footer>
        <div class="foot">
          <n-button @click="showImport = false">取消</n-button>
          <n-button type="primary" :loading="importing" @click="confirmImport">导入并送审</n-button>
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

.sub-row {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--app-border);
}

.sub-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.sub-body {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-1);
}

.num {
  font-weight: 600;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.table th,
.table td {
  text-align: left;
  padding: var(--space-2);
  border-bottom: 1px solid var(--app-border);
}

.table th {
  color: var(--app-muted);
  font-weight: 500;
}

.count-chip {
  display: inline-block;
  margin-right: var(--space-2);
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

.kv {
  display: flex;
  gap: var(--space-3);
  padding: 2px 0;
  font-size: var(--text-sm);
}

.kv > .muted {
  min-width: 80px;
}

.tip {
  margin-bottom: var(--space-3);
}

.section-title {
  margin: var(--space-3) 0 var(--space-2);
  font-weight: 600;
  font-size: var(--text-sm);
}

.section-title.conflict {
  color: var(--app-danger, #d03050);
}

.imp-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--app-border);
}

.imp-desc {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

.imp-select {
  width: 160px;
  flex-shrink: 0;
}
</style>
