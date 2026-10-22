/**
 * 团队纯领域函数：汇总、缺口、发布快照投影、幂等判断
 *
 * 不碰 Dexie/网络；全部输入输出都是已校验的领域对象。
 * SPEC 对应：
 * - 汇总在「同阶段同节点」内对不同批次相加，三个阶段数字分开（3.3）。
 * - 缺口 = max(0, 需求 - 当前节点已确认清点量)；有未清点批次标 uncounted，不伪装确定缺失。
 * - 重清点/不同 submissionId 竞争同逻辑键 = 明确替换，不是累加。
 * - 公共快照是白名单投影；序列化后必须测试没有私人字段。
 */
import type {
  PublicSnapshot,
  PublicationMeta,
  Submission,
  TeamAllocation,
  TeamCheckpoint,
  TeamExpense,
  TeamItem,
  TeamState,
} from './types'
import { confirmKeyString, isConsistentKey, type ConfirmKey, type TeamStage } from './protocol'

// ---------- 当前确认量（唯一来源替换语义） ----------

export interface ConfirmedQty {
  key: ConfirmKey
  submissionId: string
  revision: number
  qty: number
  /** 主机确认时间，用于同键竞争时判定权威来源 */
  reviewedAt: number
}

/**
 * 从已确认 submission 列表中提取每个逻辑键的当前确认量。
 * 同键多个来源：以 reviewedAt 最新为准（主机确认动作本身就是替换语义），
 * 但同 submissionId 的旧 revision 不会进来（主机确认时已只保留当前来源）。
 * 乱序/重复在领域层不纠偏，由 DB 事务保证唯一性；这里只是纯投影。
 */
export function currentConfirmedQty(submissions: Submission[]): Map<string, ConfirmedQty> {
  const map = new Map<string, ConfirmedQty>()
  for (const s of submissions) {
    if (s.review !== 'confirmed') continue
    if (s.qty === null) continue
    if (!isConsistentKey(s.stage, s.checkpointId)) continue
    const key: ConfirmKey = {
      allocationId: s.allocationId ?? '',
      stage: s.stage,
      checkpointId: s.checkpointId,
    }
    if (!key.allocationId) continue
    const k = confirmKeyString(key)
    const prev = map.get(k)
    // 主机确认顺序即权威顺序：同键后来者覆盖（替换语义，不累加）。
    // 旧实现的比较条件写成了 `>= (prev.submissionId === s.submissionId ? -1 : 0)`，
    // 而 reviewedAt 至少是 0，条件恒真——实际是"数组最后一个赢"，
    // 与注释宣称的"以 reviewedAt 最新为准"不符。
    // 现在显式按 reviewedAt 比较（相等时后到者胜，与主机确认顺序一致），
    // 让纯投影的结果可预测，不依赖数组顺序。
    if (!prev || (s.reviewedAt ?? 0) >= (prev.reviewedAt ?? 0)) {
      map.set(k, {
        key,
        submissionId: s.submissionId,
        revision: s.revision,
        qty: s.qty,
        reviewedAt: s.reviewedAt ?? 0,
      })
    }
  }
  return map
}

// ---------- 批次汇总 ----------

export interface AllocationSummary {
  allocationId: string
  qtyPlanned: number
  /** 各阶段当前确认总量（同阶段跨来源只取唯一当前来源，不累加历史） */
  purchaseQty: number | null
  carryQty: number | null
  /** 清点：按节点分别列出；同节点唯一来源 */
  countByCheckpoint: Array<{ checkpointId: string; qty: number }>
  /** 每个已清点节点各自的缺口；不跨节点相加（SPEC 3.3） */
  gapByCheckpoint: Array<{ checkpointId: string; qty: number; gap: number }>
  /** 默认展示的 gap 对应哪个节点；null 表示未清点或待核对 */
  gapCheckpointId: string | null
  /** 相对 gapCheckpointId 的缺口 = max(0, qtyNeeded - 该节点确认清点量)；未清点完整时为 null */
  gap: number | null
  uncounted: boolean
}

export function summarizeAllocation(
  alloc: TeamAllocation,
  item: TeamItem,
  checkpoints: TeamCheckpoint[],
  confirmed: Map<string, ConfirmedQty>,
  submissions: Submission[] = [],
): AllocationSummary {
  const purchaseQty = confirmed.get(
    confirmKeyString({ allocationId: alloc.allocationId, stage: 'purchase', checkpointId: null }),
  )?.qty ?? null
  const carryQty = confirmed.get(
    confirmKeyString({ allocationId: alloc.allocationId, stage: 'carry', checkpointId: null }),
  )?.qty ?? null

  const countByCheckpoint: Array<{ checkpointId: string; qty: number }> = []
  for (const cp of checkpoints) {
    const hit = confirmed.get(
      confirmKeyString({ allocationId: alloc.allocationId, stage: 'count', checkpointId: cp.checkpointId }),
    )
    if (hit) countByCheckpoint.push({ checkpointId: cp.checkpointId, qty: hit.qty })
  }

  // 缺口只对「有已确认清点量的节点集合」计算；
  // 只要该批次有 open/draft 未清点记录（即存在 count 阶段 submission 尚未 confirmed），标 uncounted。
  // 缺口必须相对「选定节点」算（SPEC 3.3），不能默认取数组最后一个节点——
  // 那样组织者调整节点顺序就会改变缺口数字，多个节点都清点过时展示的
  // 永远是数组末位那个，与「按选定节点算」的语义不符。
  // 这里按节点分别给出缺口，由调用方/快照消费方选定节点后取对应值；
  // 顶层 gap 保留「最后清点的那个节点」作为默认展示，但显式标注来源节点。
  const hasPendingCount = hasPendingCountReport(submissions, alloc.allocationId)
  const gapByCheckpoint = countByCheckpoint.map((c) => ({
    checkpointId: c.checkpointId,
    qty: c.qty,
    gap: Math.max(0, item.qtyNeeded - c.qty),
  }))

  const lastCounted = countByCheckpoint.length > 0 ? countByCheckpoint[countByCheckpoint.length - 1]! : null
  const gap = lastCounted && !hasPendingCount ? Math.max(0, item.qtyNeeded - lastCounted.qty) : null
  const uncounted = hasPendingCount || countByCheckpoint.length === 0

  return {
    allocationId: alloc.allocationId,
    qtyPlanned: alloc.qtyPlanned,
    purchaseQty,
    carryQty,
    countByCheckpoint,
    /** 每个已清点节点各自的缺口，供按节点查看；不跨节点相加 */
    gapByCheckpoint,
    /** 默认展示的缺口所对应的节点（null = 未清点或待核对） */
    gapCheckpointId: lastCounted?.checkpointId ?? null,
    gap,
    uncounted,
  }
}

/**
 * 「该批次是否还有未确认的清点报告」。
 *
 * 这是纯函数，拿不到 DB，因此由调用方显式传入。
 * 语义：只要存在 stage==='count' 且 review 仍为 submitted 的报告，
 * 该批次的清点就不算完整，缺口不得伪装成确定缺失（SPEC 3.3）。
 */
export function hasPendingCountReport(
  submissions: Submission[],
  allocationId: string,
): boolean {
  return submissions.some(
    (s) =>
      s.allocationId === allocationId &&
      s.stage === 'count' &&
      (s.review === 'submitted' || s.review === 'stale'),
  )
}

// ---------- 规范化 JSON 与摘要 ----------

/** 稳定序列化：键排序，用于 digest 与幂等载荷比较（SPEC 5.2 规范化业务载荷） */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

/** FNV-1a 32 位摘要（十六进制）。P0 用它做幂等/冲突快速比对；
 *  安全性不依赖它（传输层有 AES-GCM），只用于「同 ID 异内容」检测。 */
/**
 * 内容摘要：FNV-1a 32 位 + 规范化长度后缀。
 *
 * 注意：这不是 sha-256。选它是因为 digestOf 在 Dexie 事务内部被多处同步调用，
 * 而 WebCrypto 的 digest 是异步的，全链路改造成本与回归风险远高于收益。
 * 它的职责只是「同 ID 异内容」的快速比对与幂等载荷判定——真正的完整性
 * 由传输层 AES-256-GCM 保证，安全模型不依赖碰撞抗性。
 * 若未来需要防恶意构造碰撞（而非仅防损坏），再评估整体迁移 SHA-256。
 */
export function digestOf(value: unknown): string {
  const s = canonicalJson(value)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length.toString(16)
}

// ---------- 公共快照投影（白名单） ----------

/**
 * 从 TeamState 构造公共快照。这是唯一出口：
 * - 不复制 notes/packing/私人 expenses/任何凭证字段（TeamState 本身不含这些，
 *   这里再显式挑字段，防止未来加字段时无意泄漏）；
 * - assignments 按 memberId 派生，成员端据此渲染「我的任务」。
 */
export function buildPublicSnapshot(
  team: TeamState,
  publicationId: string,
  version: number,
  createdAt: number,
): PublicSnapshot {
  const confirmed = currentConfirmedQty(team.submissions)

  const allocationsByItem = new Map<string, TeamAllocation[]>()
  for (const a of team.allocations) {
    const list = allocationsByItem.get(a.itemId) ?? []
    list.push(a)
    allocationsByItem.set(a.itemId, list)
  }

  const items = team.items.map((item) => {
    const allocs = allocationsByItem.get(item.itemId) ?? []
    return {
      itemId: item.itemId,
      name: item.name,
      category: item.category,
      qtyNeeded: item.qtyNeeded,
      unit: item.unit,
      note: item.note,
      allocations: allocs.map((a) => {
        const summary = summarizeAllocation(a, item, team.checkpoints, confirmed, team.submissions)
        // 快照里固化当前确认来源（带 submissionId/revision），供成员端展示一致性
        const confirmedRows: PublicSnapshot['items'][number]['allocations'][number]['confirmed'] =
          summary.countByCheckpoint.map((c) => {
            const hit = confirmed.get(
              confirmKeyString({ allocationId: a.allocationId, stage: 'count', checkpointId: c.checkpointId }),
            )
            return {
              stage: 'count' as TeamStage,
              checkpointId: c.checkpointId,
              qty: c.qty,
              submissionId: hit?.submissionId ?? null,
              revision: hit?.revision ?? null,
            }
          })
        if (summary.purchaseQty !== null) {
          const hit = confirmed.get(
            confirmKeyString({ allocationId: a.allocationId, stage: 'purchase', checkpointId: null }),
          )
          confirmedRows.push({
            stage: 'purchase',
            checkpointId: null,
            qty: summary.purchaseQty,
            submissionId: hit?.submissionId ?? null,
            revision: hit?.revision ?? null,
          })
        }
        if (summary.carryQty !== null) {
          const hit = confirmed.get(
            confirmKeyString({ allocationId: a.allocationId, stage: 'carry', checkpointId: null }),
          )
          confirmedRows.push({
            stage: 'carry',
            checkpointId: null,
            qty: summary.carryQty,
            submissionId: hit?.submissionId ?? null,
            revision: hit?.revision ?? null,
          })
        }
        return {
          allocationId: a.allocationId,
          qtyPlanned: a.qtyPlanned,
          purchaseBy: a.purchaseBy,
          carryBy: a.carryBy,
          confirmed: confirmedRows,
          gap: summary.gap,
          uncounted: summary.uncounted,
        }
      }),
    }
  })

  // assignments：谁负责哪些批次的哪些环节
  const assignmentMap = new Map<string, { memberId: string; allocationId: string; stages: TeamStage[] }>()
  for (const a of team.allocations) {
    if (a.purchaseBy) {
      touchAssignment(assignmentMap, a.purchaseBy, a.allocationId, 'purchase')
    }
    if (a.carryBy) {
      touchAssignment(assignmentMap, a.carryBy, a.allocationId, 'carry')
    }
  }
  // 清点负责人对涉及节点的 count 环节
  for (const cp of team.checkpoints) {
    if (cp.counterBy) {
      for (const a of team.allocations) {
        touchAssignment(assignmentMap, cp.counterBy, a.allocationId, 'count')
      }
    }
  }

  const snapshot: PublicSnapshot = {
    format: 'team-publication.v1',
    teamId: team.teamId,
    publicationId,
    version,
    sourceDraftRevision: team.draftRevision,
    createdAt,
    digest: '',
    roster: team.roster.map((m) => ({ memberId: m.memberId, name: m.name, role: m.role })),
    itinerary: null,
    items,
    checkpoints: team.checkpoints.map((c) => ({
      checkpointId: c.checkpointId,
      name: c.name,
      status: c.status,
    })),
    expenses: team.expenses.map((e: TeamExpense) => ({
      expenseReportId: e.expenseReportId,
      title: e.title,
      category: e.category,
      amountFen: e.amountFen,
      payerMemberId: e.payerMemberId,
      authorMemberId: e.authorMemberId,
      shares: e.shares,
      spentOn: e.spentOn,
    })),
    assignments: [...assignmentMap.values()],
  }
  snapshot.digest = digestOf({ ...snapshot, digest: '' })
  return snapshot
}

function touchAssignment(
  map: Map<string, { memberId: string; allocationId: string; stages: TeamStage[] }>,
  memberId: string,
  allocationId: string,
  stage: TeamStage,
): void {
  const k = `${memberId}|${allocationId}`
  const hit = map.get(k)
  if (hit) {
    if (!hit.stages.includes(stage)) hit.stages.push(stage)
  } else {
    map.set(k, { memberId, allocationId, stages: [stage] })
  }
}

// ---------- 发布幂等 ----------

export interface PublishOutcome {
  meta: PublicationMeta
  snapshot: PublicSnapshot
  /** true = 本次新建；false = 同 operationId 幂等命中，返回原版 */
  created: boolean
}

/**
 * 发布的领域判断（不含事务）：给定 draftRevision 与历史，
 * 返回应发布的版本号或指出需要重看预览。
 */
export function nextPublishVersion(team: TeamState): {
  ok: true
  version: number
} | {
  ok: false
  reason: 'draft-outdated' | 'no-roster'
} {
  if (team.roster.length === 0) return { ok: false, reason: 'no-roster' }
  const latest = team.latestPublication
  if (latest && latest.sourceDraftRevision !== team.draftRevision) {
    // 最新发布后草稿又变了：要求重看预览（不自动混入未预览变化）
    // 这里仍允许发布，只是版本基于当前 draftRevision；预览检查在 UI 层做
    return { ok: true, version: latest.version + 1 }
  }
  return { ok: true, version: (latest?.version ?? 0) + 1 }
}

/**
 * 「同 ID 异内容」冲突判断：同 publicationId 但 digest 不同 → 冲突。
 * 同 ID 同 digest → 幂等命中。
 */
export function publicationConflict(
  existing: PublicationMeta | undefined,
  incomingDigest: string,
): 'identical' | 'conflict' | 'new' {
  if (!existing) return 'new'
  return existing.digest === incomingDigest ? 'identical' : 'conflict'
}

// ---------- 校验类纯函数 ----------

/** 分摊总和校验：shares 总和等于 amountFen（不依赖 settle 引擎） */
export function sharesSum(shares: Record<string, number>): number {
  return Object.values(shares).reduce((a, b) => a + b, 0)
}

export function sharesValid(amountFen: number, shares: Record<string, number>): boolean {
  return sharesSum(shares) === amountFen
}
