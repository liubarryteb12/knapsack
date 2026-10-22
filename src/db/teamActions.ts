/**
 * 团队持久化动作：主机接收/确认/发布、成员领取/回执，全部在 Dexie 事务里。
 *
 * 不变量（SPEC 5.2）：
 * - 主机事务成功后才返回「已接收」；调用方（协议层）据此才发 ACK。
 * - 幂等键 (teamId, actorId, action, operationId)；同键同载荷返回原结果，异载荷冲突。
 * - 发布：版本/快照/指针/历史/幂等结果同一事务；中途失败保持原指针。
 * - 领取：快照+指针+回执 outbox 同一事务；事务成功才发回执。
 * - 回执：主机端成员 latest 领取版本只单调前进。
 */
import { db } from './index'
import Dexie from 'dexie'
import type {
  PublicSnapshot,
  PublicationMeta,
  Submission,
  TeamState,
} from '../team/schema'
import {
  teamStateSchema,
  publicationMetaSchema,
  submissionSchema,
  publicSnapshotSchema,
} from '../team/schema'
import { digestOf, buildPublicSnapshot } from '../team/domain'
import { newId, confirmKeyString, isConsistentKey } from '../team/protocol'

/**
 * 一条报告的「当前确认量」逻辑键（SPEC 3.3）。
 * 非 count 阶段或缺少 allocationId 的报告不参与确认量竞争，返回 null。
 */
function confirmKeyOf(s: Submission): string | null {
  if (s.qty === null) return null
  if (s.allocationId === null) return null
  if (!isConsistentKey(s.stage, s.checkpointId)) return null
  return confirmKeyString({ allocationId: s.allocationId, stage: s.stage, checkpointId: s.checkpointId })
}

import { generateCredentialSecret, issueCredential, toB64u, fromB64u, verifyCredential } from '../team/identity'
import type { TeamIdempotencyRecord, TeamOutboxEntry, TeamLink } from './teamSchema'

// ---------- 纯数据化 ----------

/**
 * 把调用方传进来的对象还原成纯数据。
 *
 * 为什么必须做：Dexie/IndexedDB 写入走 structured clone，**不接受 Proxy**。
 * 视图层常把解析结果塞进 ref/reactive（例如 TeamMemberTab 的 importPreview），
 * 再取出来传给本层时拿到的就是响应式代理，直接 put 会抛
 * "DataCloneError: #<Object> could not be cloned"，导入路径整体失败（A34）。
 * 这些对象都是 schema 校验过的 JSON 数据（无 Date/Map/Set），JSON 往返是安全的。
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ---------- 幂等 ----------

export function idempotencyKey(
  teamId: string,
  actorMemberId: string,
  action: string,
  operationId: string,
): string {
  return `${teamId}|${actorMemberId}|${action}|${operationId}`
}

export type IdempotentOutcome<T> =
  | { kind: 'new' }
  | { kind: 'replay'; result: T }
  | { kind: 'conflict' }

/** 查幂等记录（仅供事务外调用；事务内必须用 inTxIdempotent） */
export async function checkIdempotent<T>(
  key: string,
  payloadDigest: string,
): Promise<IdempotentOutcome<T>> {
  const rec = await db.teamIdempotency.get(key)
  if (!rec) return { kind: 'new' }
  if (rec.payloadDigest !== payloadDigest) return { kind: 'conflict' }
  return { kind: 'replay', result: rec.result as T }
}

/**
 * 事务内幂等检查。
 *
 * 为什么必须在事务内：Dexie 的 'rw' 事务对涉及的表是串行的，但两个并发请求
 * 各自的事务是先后进入的。如果幂等检查放在事务外，两个请求都会读到「没有记录」
 * 然后各跑一遍业务——发布场景下就是同一个 operationId 发出两个版本
 * （实测复现：并发 Promise.all 两个 publishSnapshot，得到 version 1 和 2，
 * publicationId 还不同），直接违反 SPEC 4.2「同 operationId 重试返回原版」。
 *
 * 放进事务后，第二个请求能看到第一个已提交的幂等记录，从而短路返回原结果。
 */
async function inTxIdempotent<T>(
  key: string,
  payloadDigest: string,
): Promise<IdempotentOutcome<T>> {
  const rec = await db.teamIdempotency.get(key)
  if (!rec) return { kind: 'new' }
  if (rec.payloadDigest !== payloadDigest) return { kind: 'conflict' }
  return { kind: 'replay', result: rec.result as T }
}

// ---------- 主机：接收报告 ----------

export interface AcceptSubmissionInput {
  teamId: string
  /** 主机从凭证推导的作者（不采信请求体） */
  authorMemberId: string
  operationId: string
  /** 客户端提交的报告字段（authorMemberId 会被覆盖） */
  draft: Omit<Submission, 'authorMemberId' | 'uploadedAt' | 'review' | 'reviewNote' | 'reviewedAt'>
}

export type AcceptSubmissionResult =
  | { ok: true; submissionId: string; revision: number; /** 幂等重放命中（同 operationId 重试） */
      replayed?: boolean }
  | { ok: false; error: string; conflict?: boolean; replayed?: boolean }

/**
 * 主机接收一条报告（幂等）。
 * - 同 operationId 同载荷 → 返回原结果；
 * - 同 operationId 异载荷 → conflict；
 * - 新报告：若同 (authorId, submissionId) 且 revision 递增 → 更新（替换当前来源）；
 *   revision 不递增且内容不同 → conflict。
 */
export async function acceptSubmission(
  input: AcceptSubmissionInput,
): Promise<AcceptSubmissionResult> {
  const draft = toPlain(input.draft)
  const payloadDigest = digestOf({ ...draft, authorMemberId: input.authorMemberId })
  const key = idempotencyKey(input.teamId, input.authorMemberId, 'submission.submit', input.operationId)

  const outcome = await checkIdempotent<AcceptSubmissionResult>(key, payloadDigest)
  if (outcome.kind === 'replay') return { ...outcome.result, replayed: true }
  if (outcome.kind === 'conflict') {
    return { ok: false, error: '同 operationId 但内容不同，疑似重放冲突', conflict: true }
  }

  try {
    const result = await db.transaction('rw', db.teamState, db.teamIdempotency, async () => {
      const team = await db.teamState.get(input.teamId)
      if (!team) throw new Error('团队不存在')
      const parsed = teamStateSchema.parse(team)

      // 校验作者是名册成员
      if (!parsed.roster.some((m) => m.memberId === input.authorMemberId)) {
        throw new Error('作者不在名册中')
      }

      // SPEC 3.5：expenseReportId 是「费用来源唯一键（作者维度稳定）」，
      // 其他成员不能复用它修订。否则确认入账时按 expenseReportId 覆盖，
      // 会把别人的费用记录静默顶掉，直接丢钱。
      if (draft.expenseReportId) {
        const owner = parsed.submissions.find(
          (s) => s.expenseReportId === draft.expenseReportId,
        )
        if (owner && owner.authorMemberId !== input.authorMemberId) {
          throw new Error('这个费用来源编号已被其他成员使用')
        }
      }

      const existing = parsed.submissions.find(
        (s) => s.submissionId === draft.submissionId,
      )
      if (existing) {
        // 修订：必须同作者、revision 递增
        if (existing.authorMemberId !== input.authorMemberId) {
          throw new Error('报告归属另一作者，不能复用 submissionId 修订')
        }
        if (draft.revision <= existing.revision) {
          if (draft.revision === existing.revision) {
            // 同 revision 同内容（幂等重试路径已处理；到这里说明载荷不同）
            throw new Error('revision 未递增且内容不同')
          }
          throw new Error('revision 过时，拒绝乱序覆盖')
        }
      }

      // 网络传来的 draft 必须先过 schema 再入库。之前是直接展开写进聚合根，
      // 一个畸形载荷（revision 是字符串、qty 是负数、缺字段）就能把整个
      // TeamState 毒化——此后每次 getTeam/事务都会 teamStateSchema.parse 抛错，
      // 主机再也读不了这个团队。校验失败必须拒绝，不落库。
      // 注意：uploadedAt/review/reviewNote/reviewedAt 由主机填写，先补齐再过 schema。
      // SPEC 3.4：依据旧版分工提交的报告，进待审核列表前先标 stale，
      // 不让组织者把过时数据当新报告确认进汇总。
      // 例外：revision > 1 是作者对同一条报告的修订——它本就是在旧版本
      // 基础上补充/更正，标 stale 会让修订永远无法被确认（组织者看到的
      // 是一条永远「过时」的记录）。修订照常进待审核，由组织者判断。
      const outdated = draft.revision === 1 && draft.taskRevision < parsed.draftRevision
      const submission: Submission = submissionSchema.parse({
        ...draft,
        teamId: input.teamId,
        authorMemberId: input.authorMemberId,
        uploadedAt: Date.now(),
        review: outdated ? 'stale' : 'submitted',
        reviewNote: outdated
          ? `依据的分工版本 ${draft.taskRevision} 已过期（当前 ${parsed.draftRevision}），请领取新版后重新上报`
          : '',
        reviewedAt: null,
      })
      const nextSubs = existing
        ? parsed.submissions.map((s) => (s.submissionId === submission.submissionId ? submission : s))
        : [...parsed.submissions, submission]

      const updated: TeamState = { ...parsed, submissions: nextSubs, updatedAt: Date.now() }
      await db.teamState.put(updated)

      const res: AcceptSubmissionResult = {
        ok: true,
        submissionId: submission.submissionId,
        revision: submission.revision,
      }
      const rec: TeamIdempotencyRecord = {
        idempotencyKey: key,
        teamId: input.teamId,
        actorMemberId: input.authorMemberId,
        action: 'submission.submit',
        operationId: input.operationId,
        payloadDigest,
        result: res,
        createdAt: Date.now(),
      }
      await db.teamIdempotency.put(rec)
      return res
    })
    return result
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 主机：确认/退回 ----------

export interface ConfirmDecisionInput {
  teamId: string
  organizerMemberId: string
  operationId: string
  submissionId: string
  revision: number
  decision: 'confirmed' | 'rejected'
  note?: string
}

export type ConfirmDecisionResult =
  | { ok: true; submissionId: string; revision: number; review: 'confirmed' | 'rejected' }
  | { ok: false; error: string }

/** 主机确认/退回报告（幂等，事务） */
export async function decideSubmission(input: ConfirmDecisionInput): Promise<ConfirmDecisionResult> {
  const payloadDigest = digestOf({
    submissionId: input.submissionId,
    revision: input.revision,
    decision: input.decision,
    note: input.note ?? '',
  })
  const key = idempotencyKey(input.teamId, input.organizerMemberId, 'confirm.decision', input.operationId)
  const outcome = await checkIdempotent<ConfirmDecisionResult>(key, payloadDigest)
  if (outcome.kind === 'replay') return outcome.result
  if (outcome.kind === 'conflict') return { ok: false, error: '同 operationId 但内容不同' }

  try {
    return await db.transaction('rw', db.teamState, db.teamIdempotency, async () => {
      const team = await db.teamState.get(input.teamId)
      if (!team) throw new Error('团队不存在')
      const parsed = teamStateSchema.parse(team)

      const organizer = parsed.roster.find((m) => m.memberId === input.organizerMemberId)
      if (!organizer || organizer.role !== 'organizer') {
        throw new Error('只有组织者能确认/退回')
      }

      const sub = parsed.submissions.find(
        (s) => s.submissionId === input.submissionId && s.revision === input.revision,
      )
      if (!sub) throw new Error('未找到对应版本的报告')

      // SPEC 3.4：只有 submitted 状态的报告能被确认/退回。
      // 之前不校验，对 stale / rejected 的报告也能再点一次"确认"：
      // 误退回的报告被无声翻回 confirmed，被分工变更标 stale 的旧版报告
      // 则直接把过时数据送进当前汇总。
      if (sub.review !== 'submitted') {
        throw new Error(
          sub.review === 'stale'
            ? '这份报告依据的分工已变更，请让成员领取新版后重新上报'
            : `这份报告已是「${sub.review}」状态，不能重复确认`,
        )
      }

      const now = Date.now()
      const targetKey = confirmKeyOf(sub)

      // SPEC 3.3：同一逻辑键（allocationId+stage+checkpointId）只允许一条 confirmed。
      // 确认这一条时，把同键的其他来源降级为 stale——否则汇总会出现两个"当前确认量"，
      // 数字取决于 reviewedAt 与数组顺序（不确定），且历史来源会一直挂在 confirmed 状态。
      //
      // 费用报告的逻辑键不是 (allocationId, stage, checkpointId) 而是
      // expenseReportId（SPEC 3.5「一笔费用一个来源」）：confirmKeyOf 对
      // amountFen 为 null 以外的费用报告返回 null，旧实现因此永远不降级，
      // 同一来源的 36 与 40 会同时挂在 confirmed 上。
      const updatedSubs = parsed.submissions.map((s) => {
        if (s.submissionId === input.submissionId && s.revision === input.revision) {
          return {
            ...s,
            review: input.decision,
            reviewNote: input.note ?? '',
            reviewedAt: now,
          }
        }
        if (input.decision === 'confirmed' && s.review === 'confirmed') {
          const superseded =
            (targetKey !== null && confirmKeyOf(s) === targetKey) ||
            (sub.expenseReportId !== null && s.expenseReportId === sub.expenseReportId)
          if (superseded) {
            return {
              ...s,
              review: 'stale' as const,
              reviewNote: s.reviewNote || `被 ${input.submissionId}#${input.revision} 取代`,
              reviewedAt: now,
            }
          }
        }
        return s
      })

      // 费用确认后进入团队账本：按 expenseReportId 唯一来源，只记一次（SPEC 3.5）
      let expenses = parsed.expenses
      if (input.decision === 'confirmed') {
        const target = updatedSubs.find(
          (s) => s.submissionId === input.submissionId && s.revision === input.revision,
        )
        if (target && target.amountFen !== null && target.expenseReportId) {
          // SPEC 3.5：正式数据必须校验成员存在。付款人可以不是作者，
          // 但必须是名册成员——否则账本里会出现幽灵付款人，结算时无人对应。
          const payerId = target.payerMemberId ?? target.authorMemberId
          if (!parsed.roster.some((m) => m.memberId === payerId)) {
            throw new Error(`实际付款人 ${payerId} 不在名册中，请先让成员加入`)
          }

          // 分摊默认按全体成员均分（余数给第一位）；总额等于金额，保证账目自洽。
          // roster 为空时不应入账：均分不出任何份额，总额会是 0 ≠ amountFen。
          const memberIds = parsed.roster.map((m) => m.memberId)
          if (memberIds.length === 0) {
            throw new Error('名册为空，无法确定费用分摊')
          }
          const shares: Record<string, number> = {}
          const base = Math.floor(target.amountFen / memberIds.length)
          let rest = target.amountFen - base * memberIds.length
          for (const id of memberIds) {
            shares[id] = base + (rest > 0 ? 1 : 0)
            if (rest > 0) rest -= 1
          }
          const entry = {
            expenseReportId: target.expenseReportId,
            teamId: parsed.teamId,
            authorMemberId: target.authorMemberId,
            payerMemberId: payerId,
            amountFen: target.amountFen,
            shares,
            relatedAllocationIds: target.relatedAllocationIds,
            title: target.note?.trim() || '团队开支',
            category: 'other' as const,
            spentOn: new Date().toISOString().slice(0, 10),
            createdAt: Date.now(),
            sourceSubmissionId: target.submissionId,
            sourceRevision: target.revision,
          }
          const idx = expenses.findIndex((e) => e.expenseReportId === entry.expenseReportId)
          expenses = idx >= 0 ? expenses.map((e, i) => (i === idx ? entry : e)) : [...expenses, entry]
        }
      }

      // 关于「预览后确认新报告再发布，未预览的变化混入」：在数据层推进
      // draftRevision 是错误方案——它是分工编辑的版本，推进后 saveTeam 的
      // stale 判定会把所有依据当前分工的待审报告误判为过时（实测确认），
      // 而且确认时被迫同步抬 taskRevision，语义上把「分工版本」和「审核事实」
      // 两个概念搅在一起。正确拦截点是发布预览本身，见 TeamPublishTab：
      // 预览快照在 render 时生成，若确认动作发生在预览之后，
      // 发布时 TeamState.submissions 已变化——由 UI 层的「预览基于 draftRevision N，
      // 当前已是 N+1」提示组织者重看预览（B2-UI）。
      const updated: TeamState = {
        ...parsed,
        submissions: updatedSubs,
        expenses,
        updatedAt: Date.now(),
      }
      await db.teamState.put(updated)

      const res: ConfirmDecisionResult = {
        ok: true,
        submissionId: input.submissionId,
        revision: input.revision,
        review: input.decision,
      }
      await db.teamIdempotency.put({
        idempotencyKey: key,
        teamId: input.teamId,
        actorMemberId: input.organizerMemberId,
        action: 'confirm.decision',
        operationId: input.operationId,
        payloadDigest,
        result: res,
        createdAt: Date.now(),
      })
      return res
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 主机：发布 ----------

export interface PublishInput {
  teamId: string
  organizerMemberId: string
  operationId: string
  /** 发布者看到的草稿版本，防止并发修改混入（SPEC 4.2 sourceDraftRevision） */
  expectedDraftRevision: number
  /**
   * 发布者点「发布」时看到的预览快照摘要（buildPublicSnapshot 的 digest）。
   * 传入后与实际生成的快照比对：确认/退回等动作若发生在预览之后，
   * 实际快照会与预览不一致，发布被拒绝并要求重看预览（SPEC 4.2
   * 「不把未预览的并发变化偷偷混入」）。不传则跳过该检查（协议端无法预览）。
   */
  expectedPreviewDigest?: string
  itinerary?: PublicSnapshot['itinerary']
}

export type PublishResult =
  | { ok: true; publicationId: string; version: number; created: boolean }
  | { ok: false; error: string }

/**
 * 发布不可变快照。事务内容：
 * 版本号 → 快照 → latestPublication 指针 → publicationHistory → 幂等记录。
 * 中途任何失败事务回滚，指针保持原版（A12/A13）。
 */
export async function publishSnapshot(input: PublishInput): Promise<PublishResult> {
  // 幂等载荷：expectedDraftRevision 与 itinerary 都是业务的一部分。
  // 只含 revision 时，同 operationId 重试但换了 itinerary 的请求会静默
  // 返回第一次的结果，第二次的 itinerary 被丢弃。
  const payloadDigest = digestOf({
    expectedDraftRevision: input.expectedDraftRevision,
    itinerary: input.itinerary ?? null,
  })
  const key = idempotencyKey(input.teamId, input.organizerMemberId, 'publication.publish', input.operationId)

  try {
    return await db.transaction('rw', db.teamState, db.teamPublications, db.teamIdempotency, async () => {
      // 幂等检查必须在事务内：两个并发请求带同一 operationId 时，
      // 事务外检查会让双方都判定「新动作」，从而各自发一版（实测复现）。
      const outcome = await inTxIdempotent<PublishResult>(key, payloadDigest)
      if (outcome.kind === 'replay') {
        // 重试返回原版，不再增版（A13）
        return outcome.result
      }
      if (outcome.kind === 'conflict') throw new Error('同 operationId 但内容不同')

      const team = await db.teamState.get(input.teamId)
      if (!team) throw new Error('团队不存在')
      const parsed = teamStateSchema.parse(team)

      const organizer = parsed.roster.find((m) => m.memberId === input.organizerMemberId)
      if (!organizer || organizer.role !== 'organizer') throw new Error('只有组织者能发布')

      // 严格规则：调用方看到的草稿版本必须等于当前 draftRevision，
      // 否则说明预览之后又改过，不允许把未预览的变化偷偷混进这一版（SPEC 4.2）。
      if (input.expectedDraftRevision !== parsed.draftRevision) {
        throw new Error('草稿已变化，请重看预览后再发布')
      }
      if (parsed.roster.length === 0) throw new Error('名册为空，先加成员再发布')

      // 预览一致性（SPEC 4.2）：预览之后如果有人确认/退回了报告、
      // 或者 pendingJoins 被审批，实际生成的快照就不再是发布者看到的那份。
      // 比对 digest 拒绝掉，比 draftRevision 精确——后者只在分工编辑时变化。
      if (input.expectedPreviewDigest !== undefined) {
        const probe = buildPublicSnapshot(parsed, 'preview', 0, 0)
        if (probe.digest !== input.expectedPreviewDigest) {
          throw new Error('发布内容与预览不一致（期间有新的确认或审批），请重看预览后再发布')
        }
      }

      const version = (parsed.latestPublication?.version ?? 0) + 1
      const publicationId = newId()
      const createdAt = Date.now()

      // buildPublicSnapshot 内部已算好 digest；itinerary 是发布时才补的字段，
      // 因此只有补了 itinerary 才需要重算一次（避免每次发布都做两次全量摘要）。
      const snapshot = buildPublicSnapshot(parsed, publicationId, version, createdAt)
      if (input.itinerary) {
        snapshot.itinerary = toPlain(input.itinerary)
        snapshot.digest = digestOf({ ...snapshot, digest: '' })
      }

      const meta: PublicationMeta = publicationMetaSchema.parse({
        teamId: parsed.teamId,
        publicationId,
        version,
        createdAt,
        digest: snapshot.digest,
        sourceDraftRevision: parsed.draftRevision,
      })

      await db.teamPublications.put({ publicationId, meta, snapshot })

      const updated: TeamState = {
        ...parsed,
        latestPublication: meta,
        publicationHistory: [...parsed.publicationHistory, meta],
        updatedAt: createdAt,
      }
      await db.teamState.put(updated)

      const res: PublishResult = { ok: true, publicationId, version, created: true }
      await db.teamIdempotency.put({
        idempotencyKey: key,
        teamId: input.teamId,
        actorMemberId: input.organizerMemberId,
        action: 'publication.publish',
        operationId: input.operationId,
        payloadDigest,
        result: res,
        createdAt,
      })
      return res
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 成员：领取（快照+指针+回执 outbox 同事务） ----------

export interface IngestPublicationInput {
  teamId: string
  memberId: string
  snapshot: PublicSnapshot
  /** 领取动作的稳定 operationId（回执用同一个） */
  operationId: string
  /**
   * 是否入队回执 outbox（默认 true）。
   * 文件兜底导入时传 false：文件不证明在线身份，不能凭空产生回执。
   */
  queueReceipt?: boolean
}

export type IngestResult =
  | { ok: true; version: number; publicationId: string; receiptQueued: boolean }
  | { ok: false; error: string }

/**
 * 成员保存公共快照。事务：快照入库 → 本地指针更新 → 回执 outbox。
 * 事务成功后调用方才把回执发出去；失败则什么都不发生（A25）。
 */
export async function ingestPublication(input: IngestPublicationInput): Promise<IngestResult> {
  const plain = toPlain(input.snapshot)

  // 快照必须过 schema，且 digest 要重算后与自报值比对。
  // 之前只信对方自报的 snap.digest：一份携带自洽假摘要的快照会被当成
  // 「同一份」接受，成员端「同 publicationId 不同内容」的冲突判定直接失效；
  // 畸形快照也会入库污染团队视图。
  const snap = publicSnapshotSchema.parse(plain)
  const recomputed = digestOf({ ...snap, digest: '' })
  if (recomputed !== snap.digest) {
    return { ok: false, error: '快照校验和不一致，可能已损坏或被篡改' }
  }
  if (snap.teamId !== input.teamId) return { ok: false, error: '快照 teamId 不匹配' }

  try {
    return await db.transaction(
      'rw',
      db.teamPublications,
      db.teamState,
      db.teamOutbox,
      db.teamLink,
      async () => {
        // 同 publicationId 幂等
        const existing = await db.teamPublications.get(snap.publicationId)
        if (existing) {
          const sameDigest = existing.meta.digest === snap.digest
          if (!sameDigest) {
            return { ok: false as const, error: '同 publicationId 但内容不同，冲突' }
          }
          // 幂等命中 ≠ 回执已发。典型场景：成员先用文件兜底导入了第 3 版
          // （queueReceipt:false），之后连上主机点「领取」——命中已有
          // publicationId 就直接 return，回执永远不入队，主机一直显示
          // 该成员未领取。这里按需补入队：operationId 未入过队才补。
          const outboxHit = await db.teamOutbox.get(input.operationId)
          const wantReceipt = input.queueReceipt !== false
          let queued = !!outboxHit
          if (wantReceipt && !outboxHit) {
            await db.teamOutbox.put({
              operationId: input.operationId,
              teamId: input.teamId,
              kind: 'receipt',
              payload: { publicationId: existing.publicationId, version: existing.meta.version },
              createdAt: Date.now(),
              attempts: 0,
            })
            queued = true
          }
          return {
            ok: true as const,
            version: existing.meta.version,
            publicationId: existing.publicationId,
            receiptQueued: queued,
          }
        }

        await db.teamPublications.put({
          publicationId: snap.publicationId,
          meta: {
            teamId: snap.teamId,
            publicationId: snap.publicationId,
            version: snap.version,
            createdAt: snap.createdAt,
            digest: snap.digest,
            sourceDraftRevision: snap.sourceDraftRevision,
          },
          snapshot: snap,
        })

        // 本地指针：只前进不降级
        const state = await db.teamState.get(input.teamId)
        if (state) {
          const cur = state.latestPublication
          if (!cur || snap.version > cur.version) {
            const updated: TeamState = { ...state, latestPublication: { ...snap, digest: snap.digest } }
            await db.teamState.put(updated)
          }
        } else {
          // 成员端无 teamState 时（首次领取），创建最小骨架
          const newState: TeamState = teamStateSchema.parse({
            format: 'team.v1',
            teamId: input.teamId,
            name: `团队 ${input.teamId}`,
            myMemberId: input.memberId,
            draftRevision: 1,
            revision: 1,
            latestPublication: {
              teamId: snap.teamId,
              publicationId: snap.publicationId,
              version: snap.version,
              createdAt: snap.createdAt,
              digest: snap.digest,
              sourceDraftRevision: snap.sourceDraftRevision,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          await db.teamState.put(newState)
        }

        // 回执 outbox（事务内创建，事务成功后调用方才发）
        const wantReceipt = input.queueReceipt !== false
        if (wantReceipt) {
          const outboxEntry: TeamOutboxEntry = {
            operationId: input.operationId,
            teamId: input.teamId,
            kind: 'receipt',
            payload: {
              publicationId: snap.publicationId,
              version: snap.version,
              memberId: input.memberId,
            },
            createdAt: Date.now(),
            attempts: 0,
          }
          await db.teamOutbox.put(outboxEntry)
        }

        return {
          ok: true as const,
          version: snap.version,
          publicationId: snap.publicationId,
          receiptQueued: wantReceipt,
        }
      },
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 主机：接收回执（版本单调前进） ----------

export interface ReceiptInput {
  teamId: string
  memberId: string
  operationId: string
  publicationId: string
  version: number
}

export type ReceiptResult =
  | { ok: true; latestVersion: number; /** 幂等重放命中（同 operationId 重试） */
      replayed?: boolean }
  | { ok: false; error: string }

/** 主机记录成员领取回执；同 operationId 幂等；版本只前进不降级（A26/A27） */
export async function acceptReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  const payloadDigest = digestOf({
    publicationId: input.publicationId,
    version: input.version,
  })
  const key = idempotencyKey(input.teamId, input.memberId, 'receipt.submit', input.operationId)

  try {
    return await db.transaction('rw', db.teamState, db.teamPublications, db.teamIdempotency, async () => {
      const outcome = await inTxIdempotent<ReceiptResult>(key, payloadDigest)
      if (outcome.kind === 'replay') return { ...outcome.result, replayed: true }
      if (outcome.kind === 'conflict') throw new Error('同 operationId 但内容不同')

      // 回执必须指向真实存在的发布版本。之前不校验，成员提交一个
      // version=999999 + 不存在的 publicationId 就能让主机永久显示
      // 「已领取第 999999 版」，且因单调递增再也纠正不回来。
      const pub = await db.teamPublications.get(input.publicationId)
      if (!pub) throw new Error('回执指向的发布版本不存在')
      if (pub.meta.teamId !== input.teamId) throw new Error('回执指向的发布版本不属于这个团队')
      if (pub.meta.version !== input.version) {
        throw new Error(`回执版本号与发布记录不一致（记录为第 ${pub.meta.version} 版）`)
      }

      const team = await db.teamState.get(input.teamId)
      if (!team) throw new Error('团队不存在')

      // 找到成员当前的 receiptLatestVersion：从幂等表里的历史回执推断，
      // 保持 TeamState schema 不含回执状态（回执历史只进幂等表）。
      const prevReceipts = await db.teamIdempotency
        .where('teamId')
        .equals(input.teamId)
        .toArray()
      let latest = 0
      for (const r of prevReceipts) {
        if (r.action !== 'receipt.submit') continue
        if (r.actorMemberId !== input.memberId) continue
        const res = r.result as ReceiptResult
        if (res && res.ok && res.latestVersion > latest) latest = res.latestVersion
      }
      // 旧版回执晚到：记录但不前进（不降级也不倒退）
      const finalVersion = Math.max(latest, input.version)

      const res: ReceiptResult = { ok: true, latestVersion: finalVersion }
      await db.teamIdempotency.put({
        idempotencyKey: key,
        teamId: input.teamId,
        actorMemberId: input.memberId,
        action: 'receipt.submit',
        operationId: input.operationId,
        payloadDigest,
        result: res,
        createdAt: Date.now(),
      })
      return res
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- outbox 辅助 ----------

export async function queueOutbox(entry: Omit<TeamOutboxEntry, 'attempts' | 'createdAt'>): Promise<void> {
  const existing = await db.teamOutbox.get(entry.operationId)
  if (existing) return // 幂等
  const full: TeamOutboxEntry = { ...entry, attempts: 0, createdAt: Date.now() }
  await db.teamOutbox.put(full)
}

export async function pendingOutbox(teamId: string): Promise<TeamOutboxEntry[]> {
  return db.teamOutbox.where('teamId').equals(teamId).toArray()
}

export async function clearOutbox(operationId: string): Promise<void> {
  await db.teamOutbox.delete(operationId)
}

// ---------- 团队 CRUD ----------

export async function createTeam(input: {
  name: string
  organizerName: string
  itinerary?: PublicSnapshot['itinerary']
}): Promise<TeamState> {
  const now = Date.now()
  const organizerId = newId()
  const state = teamStateSchema.parse({
    format: 'team.v1',
    teamId: newId(),
    name: input.name,
    myMemberId: organizerId,
    draftRevision: 1,
    revision: 1,
    roster: [{ memberId: organizerId, name: input.organizerName, role: 'organizer', joinedAt: now }],
    latestPublication: null,
    publicationHistory: [],
    // 主机长期凭证密钥：只在本机，绝不下发
    credentialSecret: toB64u(generateCredentialSecret()),
    pendingJoins: [],
    createdAt: now,
    updatedAt: now,
  })
  await db.teamState.put(state)
  return state
}

/**
 * 保存团队草稿。
 *
 * A08（SPEC 3.4）：编辑会推进 draftRevision，此时所有「依据旧 draftRevision 提交」
 * 且仍处于 submitted/confirmed 的报告都应标记 stale——它们描述的是旧版分工，
 * 不能继续代表当前事实。已 confirmed 的降级为 stale（让出逻辑键），
 * 待审的直接标 stale（不再进入待审核列表）。
 */
/**
 * 保存团队草稿。
 *
 * 必须是读-改-写，不能整包 put：调用方（如 TeamSetupTab.mutate）拿到的是
 * 组件挂载时的 props 快照，主机会话开着时成员可能刚提交了新报告、
 * 组织者可能刚在另一个 tab 确认了一条——整包覆盖会把这些静默抹掉。
 *
 * 守卫：
 * - draftRevision 必须不低于库里的现值（防止旧快照把版本回退）；
 * - 只由调用方提供的「编辑字段」覆盖，submissions/expenses/publication*
 *   一律以库里最新值为准，避免并发写入互相覆盖。
 */
export async function saveTeam(state: TeamState): Promise<TeamState> {
  const now = Date.now()
  return await db.transaction('rw', db.teamState, async () => {
    const current = await db.teamState.get(state.teamId)
    if (!current) throw new Error('团队不存在')
    const base = teamStateSchema.parse(current)

    if (state.draftRevision < base.draftRevision) {
      throw new Error(
        `草稿版本落后（提交 ${state.draftRevision}，当前 ${base.draftRevision}），请刷新后重试`,
      )
    }

    const merged: TeamState = {
      ...base,
      // 调用方可编辑的展示/结构字段
      name: state.name,
      myMemberId: state.myMemberId,
      roster: state.roster,
      items: state.items,
      allocations: state.allocations,
      checkpoints: state.checkpoints,
      pendingJoins: state.pendingJoins,
      draftRevision: state.draftRevision,
      // 并发写入的字段一律取库里的最新值
      submissions: base.submissions,
      expenses: base.expenses,
      latestPublication: base.latestPublication,
      publicationHistory: base.publicationHistory,
      credentialSecret: base.credentialSecret,
      updatedAt: now,
    }

    // A08：分工推进后，依据旧版本提交的报告标 stale
    merged.submissions = merged.submissions.map((s) =>
      s.taskRevision < merged.draftRevision &&
      (s.review === 'submitted' || s.review === 'confirmed')
        ? {
            ...s,
            review: 'stale' as const,
            reviewNote:
              s.reviewNote || `分工已更新（报告依据版本 ${s.taskRevision}，当前 ${merged.draftRevision}）`,
            reviewedAt: now,
          }
        : s,
    )

    const parsed = teamStateSchema.parse(merged)
    await db.teamState.put(parsed)
    return parsed
  })
}

export async function getTeam(teamId: string): Promise<TeamState | undefined> {
  const raw = await db.teamState.get(teamId)
  return raw ? teamStateSchema.parse(raw) : undefined
}

export async function listTeams(): Promise<TeamState[]> {
  const all = await db.teamState.toArray()
  return all.map((t) => teamStateSchema.parse(t))
}

/**
 * 团队列表用的轻量投影。
 *
 * 列表页只需要团队名、名册规模、物资/节点计数和发布状态，
 * 但 TeamState 里还塞着 submissions / expenses / pendingJoins 这些大数组
 * （一个大团队光 submissions 就能上千条）。列表页一次性全拉进来，
 * 进团队详情又要拉一次完整聚合根，等于同一份数据在内存里存两份。
 *
 * 这里只挑列表真正渲染的字段，其余置空。注意：返回对象**不是**完整 TeamState，
 * 只用于列表展示，任何编辑/确认/发布操作都必须先 getTeam() 取完整聚合根。
 */
export interface TeamListItem {
  teamId: string
  name: string
  myMemberId: string | null
  draftRevision: number
  revision: number
  roster: TeamState['roster']
  items: Array<{ itemId: string }>
  allocations: Array<{ allocationId: string }>
  checkpoints: Array<{ checkpointId: string }>
  latestPublication: TeamState['latestPublication']
  createdAt: number
  updatedAt: number
}

export async function listTeamSummaries(): Promise<TeamListItem[]> {
  const all = await db.teamState.toArray()
  return all.map((t) => {
    const parsed = teamStateSchema.parse(t)
    return {
      teamId: parsed.teamId,
      name: parsed.name,
      myMemberId: parsed.myMemberId,
      draftRevision: parsed.draftRevision,
      revision: parsed.revision,
      roster: parsed.roster,
      // 列表只数个数，不需要完整对象
      items: parsed.items.map((i) => ({ itemId: i.itemId })),
      allocations: parsed.allocations.map((a) => ({ allocationId: a.allocationId })),
      checkpoints: parsed.checkpoints.map((c) => ({ checkpointId: c.checkpointId })),
      latestPublication: parsed.latestPublication,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    }
  })
}

export async function getPublication(publicationId: string): Promise<{ meta: PublicationMeta; snapshot: PublicSnapshot } | undefined> {
  const row = await db.teamPublications.get(publicationId)
  return row ? { meta: row.meta, snapshot: row.snapshot } : undefined
}

export async function latestPublicationOf(teamId: string): Promise<PublicSnapshot | undefined> {
  const team = await db.teamState.get(teamId)
  if (!team?.latestPublication) return undefined
  const row = await db.teamPublications.get(team.latestPublication.publicationId)
  return row?.snapshot
}

export async function getTeamLink(teamId: string): Promise<TeamLink | undefined> {
  return db.teamLink.get(teamId)
}

export async function putTeamLink(link: TeamLink): Promise<void> {
  await db.teamLink.put(link)
}

// ---------- 身份：加入申请 / 审批 / 凭证 / 授权（P2） ----------

export interface JoinRequestInput {
  teamId: string
  joinRequestId: string
  deviceId: string
  memberName: string
  clientPub: string
}

export type JoinStatusResult =
  | { ok: true; status: 'pending' }
  | { ok: true; status: 'rejected' }
  | { ok: true; status: 'approved'; memberId: string; credential: string; deviceId: string }
  | { ok: false; error: string }

/**
 * 成员提交加入申请（幂等：同 joinRequestId 重复提交返回当前状态）。
 * 只登记，不自动建成员、不凭自报名字给身份（SPEC 6.2）。
 */
export async function registerJoinRequest(input: JoinRequestInput): Promise<JoinStatusResult> {
  try {
    return await db.transaction('rw', db.teamState, async () => {
      const team = await db.teamState.get(input.teamId)
      if (!team) throw new Error('团队不存在')
      const parsed = teamStateSchema.parse(team)

      const existing = parsed.pendingJoins.find((j) => j.joinRequestId === input.joinRequestId)
      if (existing) return toJoinStatus(existing)

      const entry = {
        joinRequestId: input.joinRequestId,
        deviceId: input.deviceId,
        memberName: input.memberName,
        clientPub: input.clientPub,
        status: 'pending' as const,
        memberId: null,
        credential: null,
        createdAt: Date.now(),
      }
      const updated: TeamState = {
        ...parsed,
        pendingJoins: [...parsed.pendingJoins, entry],
        updatedAt: Date.now(),
      }
      await db.teamState.put(updated)
      return { ok: true as const, status: 'pending' as const }
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 成员轮询审批状态；只有主机已审批时才会带出凭证 */
/**
 * 成员轮询加入申请状态。
 *
 * requesterPub 用于把凭证交付绑定到发起申请的那个会话：joinRequestId
 * 虽是客户端随机生成、只在加密信道传输，但一旦经日志/剪贴板/同步泄露，
 * 没有这层绑定，任何会话都能凭它把 memberId + credential 领走。
 * 传 undefined（老协议/测试直调）时跳过校验，行为与旧版一致。
 */
export async function getJoinStatus(
  teamId: string,
  joinRequestId: string,
  requesterPub?: string,
): Promise<JoinStatusResult> {
  const team = await getTeam(teamId)
  if (!team) return { ok: false, error: '团队不存在' }
  const entry = team.pendingJoins.find((j) => j.joinRequestId === joinRequestId)
  if (!entry) return { ok: false, error: '没有这条加入申请' }
  if (requesterPub !== undefined && entry.clientPub && entry.clientPub !== requesterPub) {
    return { ok: false, error: '加入申请不属于当前会话' }
  }
  return toJoinStatus(entry)
}

function toJoinStatus(entry: {
  status: 'pending' | 'approved' | 'rejected'
  memberId: string | null
  credential: string | null
  deviceId: string
}): JoinStatusResult {
  if (entry.status === 'approved' && entry.memberId && entry.credential) {
    return {
      ok: true,
      status: 'approved',
      memberId: entry.memberId,
      credential: entry.credential,
      deviceId: entry.deviceId,
    }
  }
  if (entry.status === 'rejected') return { ok: true, status: 'rejected' }
  return { ok: true, status: 'pending' }
}

export interface ApproveJoinInput {
  teamId: string
  organizerMemberId: string
  joinRequestId: string
  /** 恢复配对时传入原 memberId；不传则新建成员 */
  restoreMemberId?: string
}

export type ApproveJoinResult =
  | { ok: true; memberId: string; credential: string; restored: boolean }
  | { ok: false; error: string }

/**
 * 组织者审批加入：绑定名册 memberId 并签发逐成员凭证。
 * - 新建：生成新 memberId，加入名册；
 * - 恢复配对（restoreMemberId 指定且存在）：保留原 memberId，撤销旧凭证后重发，
 *   不新建同名成员（SPEC 6.2 / A21）。
 */
export async function approveJoin(input: ApproveJoinInput): Promise<ApproveJoinResult> {
  try {
    return await db.transaction('rw', db.teamState, async () => {
      const team = await db.teamState.get(input.teamId)
      if (!team) throw new Error('团队不存在')
      const parsed = teamStateSchema.parse(team)

      const organizer = parsed.roster.find((m) => m.memberId === input.organizerMemberId)
      if (!organizer || organizer.role !== 'organizer') throw new Error('只有组织者能审批加入')
      if (!parsed.credentialSecret) throw new Error('团队缺少凭证密钥')

      const join = parsed.pendingJoins.find((j) => j.joinRequestId === input.joinRequestId)
      if (!join) throw new Error('没有这条加入申请')

      const secret = fromB64u(parsed.credentialSecret)

      // 恢复配对：保留原 memberId（不重复名册）
      let memberId: string
      let roster = parsed.roster
      const restored = !!input.restoreMemberId
      if (input.restoreMemberId) {
        const target = parsed.roster.find((m) => m.memberId === input.restoreMemberId)
        if (!target) throw new Error('要恢复的成员不在名册中')
        memberId = target.memberId
      } else {
        memberId = newId()
        roster = [
          ...parsed.roster,
          { memberId, name: join.memberName, role: 'member' as const, joinedAt: Date.now() },
        ]
      }

      const credential = await Dexie.waitFor(issueCredential(secret, parsed.teamId, memberId, join.deviceId))

      const updated: TeamState = {
        ...parsed,
        roster,
        pendingJoins: parsed.pendingJoins.map((j) =>
          j.joinRequestId === input.joinRequestId
            ? { ...j, status: 'approved' as const, memberId, credential }
            : j,
        ),
        updatedAt: Date.now(),
      }
      await db.teamState.put(updated)
      return { ok: true as const, memberId, credential, restored }
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function rejectJoin(
  teamId: string,
  organizerMemberId: string,
  joinRequestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await db.transaction('rw', db.teamState, async () => {
      const team = await db.teamState.get(teamId)
      if (!team) throw new Error('团队不存在')
      const parsed = teamStateSchema.parse(team)
      const organizer = parsed.roster.find((m) => m.memberId === organizerMemberId)
      if (!organizer || organizer.role !== 'organizer') throw new Error('只有组织者能审批加入')

      const updated: TeamState = {
        ...parsed,
        pendingJoins: parsed.pendingJoins.map((j) =>
          j.joinRequestId === joinRequestId ? { ...j, status: 'rejected' as const } : j,
        ),
        updatedAt: Date.now(),
      }
      await db.teamState.put(updated)
      return { ok: true as const }
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface ActorClaim {
  memberId: string
  deviceId: string
  credential: string
}

/**
 * 从凭证推导请求作者（服务端授权）：不采信请求体里的自报身份。
 * 凭证无效或成员不在名册 → null，调用方必须拒绝请求（A15）。
 */
export async function resolveActor(teamId: string, claim: ActorClaim): Promise<{
  memberId: string
  role: 'organizer' | 'member'
} | null> {
  const team = await getTeam(teamId)
  if (!team || !team.credentialSecret) return null
  const member = team.roster.find((m) => m.memberId === claim.memberId)
  if (!member) return null
  const ok = await verifyCredential(
    fromB64u(team.credentialSecret),
    teamId,
    claim.memberId,
    claim.deviceId,
    claim.credential,
  )
  if (!ok) return null
  return { memberId: member.memberId, role: member.role }
}

/** 读取主机会话所需的凭证密钥（仅主机调用） */
export async function getCredentialSecret(teamId: string): Promise<Uint8Array | null> {
  const team = await getTeam(teamId)
  if (!team?.credentialSecret) return null
  return fromB64u(team.credentialSecret)
}
