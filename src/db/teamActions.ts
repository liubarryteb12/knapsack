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

/** 兼容旧调用名 */
function targetConfirmKey(s: Submission | undefined): string | null {
  return s ? confirmKeyOf(s) : null
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

/** 查幂等记录（不入事务；事务内请用 ensureIdempotent 的变体） */
export async function checkIdempotent<T>(
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
  | { ok: true; submissionId: string; revision: number }
  | { ok: false; error: string; conflict?: boolean }

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
  if (outcome.kind === 'replay') return outcome.result
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

      const submission: Submission = {
        ...draft,
        teamId: input.teamId,
        authorMemberId: input.authorMemberId,
        uploadedAt: Date.now(),
        review: 'submitted',
        reviewNote: '',
        reviewedAt: null,
      }
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

      const now = Date.now()
      const targetKey = targetConfirmKey(
        parsed.submissions.find(
          (s) => s.submissionId === input.submissionId && s.revision === input.revision,
        ),
      )

      // SPEC 3.3：同一逻辑键（allocationId+stage+checkpointId）只允许一条 confirmed。
      // 确认这一条时，把同键的其他来源降级为 stale——否则汇总会出现两个"当前确认量"，
      // 数字取决于 reviewedAt 与数组顺序（不确定），且历史来源会一直挂在 confirmed 状态。
      const updatedSubs = parsed.submissions.map((s) => {
        if (s.submissionId === input.submissionId && s.revision === input.revision) {
          return {
            ...s,
            review: input.decision,
            reviewNote: input.note ?? '',
            reviewedAt: now,
          }
        }
        if (
          input.decision === 'confirmed' &&
          s.review === 'confirmed' &&
          targetKey !== null &&
          confirmKeyOf(s) === targetKey
        ) {
          return {
            ...s,
            review: 'stale' as const,
            reviewNote: s.reviewNote || `被 ${input.submissionId}#${input.revision} 取代`,
            reviewedAt: now,
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
  // 幂等载荷：expectedDraftRevision 是业务的一部分
  const payloadDigest = digestOf({ expectedDraftRevision: input.expectedDraftRevision })
  const key = idempotencyKey(input.teamId, input.organizerMemberId, 'publication.publish', input.operationId)
  const outcome = await checkIdempotent<PublishResult>(key, payloadDigest)
  if (outcome.kind === 'replay') {
    // 重试返回原版，不再增版（A13）
    return outcome.result
  }
  if (outcome.kind === 'conflict') return { ok: false, error: '同 operationId 但内容不同' }

  try {
    return await db.transaction('rw', db.teamState, db.teamPublications, db.teamIdempotency, async () => {
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
  const snap = toPlain(input.snapshot)
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
          // 幂等命中：不重复入队回执
          const outboxHit = await db.teamOutbox.get(input.operationId)
          return {
            ok: true as const,
            version: existing.meta.version,
            publicationId: existing.publicationId,
            receiptQueued: !outboxHit ? false : true,
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
  | { ok: true; latestVersion: number }
  | { ok: false; error: string }

/** 主机记录成员领取回执；同 operationId 幂等；版本只前进不降级（A26/A27） */
export async function acceptReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  const payloadDigest = digestOf({
    publicationId: input.publicationId,
    version: input.version,
  })
  const key = idempotencyKey(input.teamId, input.memberId, 'receipt.submit', input.operationId)
  const outcome = await checkIdempotent<ReceiptResult>(key, payloadDigest)
  if (outcome.kind === 'replay') return outcome.result
  if (outcome.kind === 'conflict') return { ok: false, error: '同 operationId 但内容不同' }

  try {
    return await db.transaction('rw', db.teamState, db.teamIdempotency, async () => {
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
export async function saveTeam(state: TeamState): Promise<TeamState> {
  const now = Date.now()
  const staleMarked: TeamState = {
    ...state,
    submissions: state.submissions.map((s) =>
      s.taskRevision < state.draftRevision &&
      (s.review === 'submitted' || s.review === 'confirmed')
        ? {
            ...s,
            review: 'stale' as const,
            reviewNote: s.reviewNote || `分工已更新（报告依据版本 ${s.taskRevision}，当前 ${state.draftRevision}）`,
            reviewedAt: now,
          }
        : s,
    ),
    updatedAt: now,
  }
  const parsed = teamStateSchema.parse(staleMarked)
  await db.teamState.put(parsed)
  return parsed
}

export async function getTeam(teamId: string): Promise<TeamState | undefined> {
  const raw = await db.teamState.get(teamId)
  return raw ? teamStateSchema.parse(raw) : undefined
}

export async function listTeams(): Promise<TeamState[]> {
  const all = await db.teamState.toArray()
  return all.map((t) => teamStateSchema.parse(t))
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
export async function getJoinStatus(teamId: string, joinRequestId: string): Promise<JoinStatusResult> {
  const team = await getTeam(teamId)
  if (!team) return { ok: false, error: '团队不存在' }
  const entry = team.pendingJoins.find((j) => j.joinRequestId === joinRequestId)
  if (!entry) return { ok: false, error: '没有这条加入申请' }
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
