/**
 * P7 单机验收 · Node 侧 fixture 构造
 *
 * 所有 fixture 都过真实 src/team/schema.ts 的 zod 校验，快照用真实 buildPublicSnapshot /
 * serializePublicFile 生成，避免「手写一个应用读不进去的假数据」。
 * 说明：同一台设备同一个 teamId 只有一行 teamState，myMemberId 只能是一个角色，
 * 因此组织者视图（甲）与成员视图（乙）用两个独立 teamId。
 */
import { teamStateSchema, publicationMetaSchema } from '../../src/team/schema'
import type { TeamState, Submission, PublicSnapshot, PublicationMeta } from '../../src/team/schema'
import { TEAM_FORMAT } from '../../src/team/protocol'
import { buildPublicSnapshot } from '../../src/team/domain'
import { serializePublicFile } from '../../src/team/teamFile'
import type {
  TeamIdempotencyRecord,
  TeamLink,
  TeamOutboxEntry,
  TeamPublicationRow,
} from '../../src/db/teamSchema'

export const ORG_TEAM_ID = 'p7teamorg0001'
export const MEM_TEAM_ID = 'p7teammem0001'
export const JIA = 'p7mem-jia0001'
export const YI = 'p7mem-yi00001'
export const BING = 'p7mem-bing001'
export const ORG_ALLOC = 'p7alloc-water01'
export const ORG_CP = 'p7cp-gather01'
export const MEM_PUB_V1 = 'p7pub-mem0001v1'
export const MEM_PUB_V2 = 'p7pub-mem0001v2'
export const MEM_DEVICE_ID = 'p7device-yi0001'
export const MEM_CREDENTIAL = 'p7credential-yi-000000000000000000'
export const MEM_JOIN_REQUEST = 'p7join-yi000001'
/** fixture 时间基线：2026-10-21T18:00:00+08:00 */
export const T0 = Date.UTC(2026, 9, 21, 10, 0, 0)

const SUB_BASE = {
  revision: 1,
  taskRevision: 3,
  relatedAllocationIds: [ORG_ALLOC],
  reviewNote: '',
  reviewedAt: null,
}

/** 组织者团队（甲）：1 物资 / 1 批次 / 1 节点 / 3 名成员 / 5 条上报（4 待审核 + 1 已退回） */
function orgTeam(): TeamState {
  const submissions: Submission[] = [
    {
      ...SUB_BASE,
      submissionId: 'p7sub-purchase01',
      teamId: ORG_TEAM_ID,
      authorMemberId: YI,
      allocationId: ORG_ALLOC,
      stage: 'purchase',
      checkpointId: null,
      qty: 24,
      amountFen: null,
      expenseReportId: null,
      payerMemberId: null,
      note: '超市买的，24 瓶',
      uploadedAt: T0 + 10_000,
      review: 'submitted',
    },
    {
      ...SUB_BASE,
      submissionId: 'p7sub-carry00001',
      teamId: ORG_TEAM_ID,
      authorMemberId: BING,
      allocationId: ORG_ALLOC,
      stage: 'carry',
      checkpointId: null,
      qty: 24,
      amountFen: null,
      expenseReportId: null,
      payerMemberId: null,
      note: '已装车',
      uploadedAt: T0 + 11_000,
      review: 'submitted',
    },
    {
      ...SUB_BASE,
      submissionId: 'p7sub-count00001',
      teamId: ORG_TEAM_ID,
      authorMemberId: JIA,
      allocationId: ORG_ALLOC,
      stage: 'count',
      checkpointId: ORG_CP,
      qty: 20,
      amountFen: null,
      expenseReportId: null,
      payerMemberId: null,
      note: '少 4 瓶',
      uploadedAt: T0 + 12_000,
      review: 'submitted',
    },
    {
      ...SUB_BASE,
      submissionId: 'p7sub-expense001',
      teamId: ORG_TEAM_ID,
      authorMemberId: YI,
      allocationId: ORG_ALLOC,
      stage: 'purchase',
      checkpointId: null,
      qty: null,
      amountFen: 3600,
      expenseReportId: 'p7exp-0000001',
      payerMemberId: BING,
      note: '36 元水费（丙垫付）',
      uploadedAt: T0 + 13_000,
      review: 'submitted',
    },
    {
      ...SUB_BASE,
      submissionId: 'p7sub-carryrej01',
      teamId: ORG_TEAM_ID,
      authorMemberId: BING,
      allocationId: ORG_ALLOC,
      stage: 'carry',
      checkpointId: null,
      qty: 24,
      amountFen: null,
      expenseReportId: null,
      payerMemberId: null,
      note: '第二次拍照重报',
      uploadedAt: T0 + 14_000,
      review: 'rejected',
      reviewNote: '数量与采购确认不一致，请补充照片',
      reviewedAt: T0 + 20_000,
    },
  ]
  return teamStateSchema.parse({
    format: TEAM_FORMAT,
    teamId: ORG_TEAM_ID,
    name: 'P7 验收团队（甲·主机）',
    myMemberId: JIA,
    draftRevision: 3,
    revision: 5,
    roster: [
      { memberId: JIA, name: '甲', role: 'organizer', joinedAt: T0 },
      { memberId: YI, name: '乙', role: 'member', joinedAt: T0 + 1_000 },
      { memberId: BING, name: '丙', role: 'member', joinedAt: T0 + 2_000 },
    ],
    items: [{ itemId: 'p7item-water01', name: '瓶装水', category: 'food', qtyNeeded: 24, unit: '瓶', note: '' }],
    allocations: [
      { allocationId: ORG_ALLOC, itemId: 'p7item-water01', qtyPlanned: 24, purchaseBy: YI, carryBy: BING, note: '' },
    ],
    checkpoints: [{ checkpointId: ORG_CP, name: '出发集合', counterBy: JIA, status: 'open', note: '' }],
    submissions,
    expenses: [],
    latestPublication: null,
    publicationHistory: [],
    credentialSecret: 'p7credentialsecret000000000000000000',
    pendingJoins: [],
    createdAt: T0,
    updatedAt: T0 + 30_000,
  })
}

/** 成员团队（乙）：未领取任何版本的基础行 */
function memBase(): TeamState {
  return teamStateSchema.parse({
    format: TEAM_FORMAT,
    teamId: MEM_TEAM_ID,
    name: 'P7 验收团队（乙·成员）',
    myMemberId: YI,
    draftRevision: 2,
    revision: 3,
    roster: [
      { memberId: JIA, name: '甲', role: 'organizer', joinedAt: T0 },
      { memberId: YI, name: '乙', role: 'member', joinedAt: T0 + 1_000 },
    ],
    items: [{ itemId: 'p7item-water01', name: '瓶装水', category: 'food', qtyNeeded: 24, unit: '瓶', note: '' }],
    allocations: [
      { allocationId: ORG_ALLOC, itemId: 'p7item-water01', qtyPlanned: 24, purchaseBy: YI, carryBy: YI, note: '' },
    ],
    checkpoints: [{ checkpointId: ORG_CP, name: '出发集合', counterBy: JIA, status: 'open', note: '' }],
    submissions: [],
    expenses: [],
    latestPublication: null,
    publicationHistory: [],
    credentialSecret: null,
    pendingJoins: [],
    createdAt: T0 + 1_000,
    updatedAt: T0 + 6_000,
  })
}

function metaOf(snapshot: PublicSnapshot): PublicationMeta {
  return publicationMetaSchema.parse({
    teamId: snapshot.teamId,
    publicationId: snapshot.publicationId,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    digest: snapshot.digest,
    sourceDraftRevision: snapshot.sourceDraftRevision,
  })
}

export interface OrgFixture {
  teams: TeamState[]
  publications: TeamPublicationRow[]
  outbox: TeamOutboxEntry[]
  idempotency: TeamIdempotencyRecord[]
  links: TeamLink[]
}

/** 组织者 fixture；receiptVersions 用来预置「分发状态」里各成员已领取到第几版 */
export function orgFixture(receiptVersions: Record<string, number> = { [YI]: 1, [BING]: 2 }): OrgFixture {
  const idempotency: TeamIdempotencyRecord[] = Object.entries(receiptVersions).map(([memberId, version], i) => {
    const operationId = 'p7op-receipt-' + memberId + '-' + version
    return {
      idempotencyKey: ORG_TEAM_ID + '|' + memberId + '|receipt.submit|' + operationId,
      teamId: ORG_TEAM_ID,
      actorMemberId: memberId,
      action: 'receipt.submit',
      operationId,
      payloadDigest: 'p7digest-' + i,
      result: { ok: true, latestVersion: version },
      createdAt: T0 + 40_000 + i,
    }
  })
  return { teams: [orgTeam()], publications: [], outbox: [], idempotency, links: [] }
}

export interface MemFixture {
  teams: TeamState[]
  publications: TeamPublicationRow[]
  outbox: TeamOutboxEntry[]
  idempotency: TeamIdempotencyRecord[]
  links: TeamLink[]
  /** 本地第 1 版快照（UI 用来渲染「本机保存：第 N 版」与「我的任务」） */
  snapshotV1: PublicSnapshot
  /** 第 2 版 .team-public 文件文本（A34 导入用） */
  fileV2Text: string
  fileV2Name: string
}

/**
 * 成员 fixture：本机持有第 1 版 + 2 条待补传 outbox（1 条回执 + 1 条上报）
 * @param withPublication 是否注入第 1 版快照与指针
 */
export function memFixture(withPublication = true): MemFixture {
  const base = memBase()
  const snapshotV1 = buildPublicSnapshot(base, MEM_PUB_V1, 1, T0 + 7_000)
  const metaV1 = metaOf(snapshotV1)
  const snapshotV2 = buildPublicSnapshot(base, MEM_PUB_V2, 2, T0 + 8_000)
  const team = teamStateSchema.parse(
    withPublication
      ? { ...base, latestPublication: metaV1, publicationHistory: [metaV1] }
      : { ...base, latestPublication: null, publicationHistory: [] },
  )
  const publications: TeamPublicationRow[] = withPublication
    ? [{ publicationId: snapshotV1.publicationId, meta: metaV1, snapshot: snapshotV1 }]
    : []
  const outbox: TeamOutboxEntry[] = [
    {
      operationId: 'p7op-outbox-receipt-1',
      teamId: MEM_TEAM_ID,
      kind: 'receipt',
      payload: { publicationId: snapshotV1.publicationId, version: 1 },
      createdAt: T0 + 9_000,
      attempts: 1,
    },
    {
      operationId: 'p7op-outbox-submit-1',
      teamId: MEM_TEAM_ID,
      kind: 'submission',
      payload: { submissionId: 'p7sub-mem-pending01', revision: 1 },
      createdAt: T0 + 9_500,
      attempts: 2,
    },
  ]
  const links: TeamLink[] = [
    {
      teamId: MEM_TEAM_ID,
      memberId: YI,
      memberName: '乙',
      joinRequestId: MEM_JOIN_REQUEST,
      deviceId: MEM_DEVICE_ID,
      credential: MEM_CREDENTIAL,
      localTripId: null,
      joinedAt: T0 + 1_500,
    },
  ]
  return {
    teams: [team],
    publications,
    outbox,
    idempotency: [],
    links,
    snapshotV1,
    fileV2Text: serializePublicFile(snapshotV2),
    fileV2Name: 'P7-验收团队（乙·成员）-第2版.team-public',
  }
}

/** 只取 fixture 的注入载荷（去掉辅助字段） */
export function payloadOf(fx: { teams?: unknown[]; publications?: unknown[]; outbox?: unknown[]; idempotency?: unknown[]; links?: unknown[] }) {
  return {
    teams: fx.teams ?? [],
    publications: fx.publications ?? [],
    outbox: fx.outbox ?? [],
    idempotency: fx.idempotency ?? [],
    links: fx.links ?? [],
  }
}
