/**
 * 团队数据库事务测试（P1）——需要 IndexedDB，用 fake-indexeddb 模拟。
 *
 * 运行：npx tsx scripts/test-team-db.ts
 * 覆盖 PLAN：A12（发布事务中途失败）、A13（发布响应丢失幂等重试）、
 * A25（领取事务原子）、A26（回执幂等）、A27（回执版本单调），
 * 以及 A01（旧 trips 数据升级保留）。
 */
import 'fake-indexeddb/auto'
import { digestOf } from '../src/team/domain'
import { types as utilTypes } from 'node:util'
import { KnapsackDB } from '../src/db/index'
import { teamStateSchema, type TeamState } from '../src/team/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

// ---------- 测试库 ----------

function makeTeamState(teamId: string): TeamState {
  return teamStateSchema.parse({
    format: 'team.v1',
    teamId,
    name: '事务测试团',
    myMemberId: 'org1',
    draftRevision: 1,
    revision: 1,
    roster: [
      { memberId: 'org1', name: '甲', role: 'organizer', joinedAt: 1 },
      { memberId: 'm2', name: '乙', role: 'member', joinedAt: 2 },
    ],
    items: [{ itemId: 'item1', name: '水', category: 'food', qtyNeeded: 24, unit: '瓶', note: '' }],
    allocations: [{ allocationId: 'a1', itemId: 'item1', qtyPlanned: 24, purchaseBy: 'm2', carryBy: 'm2', note: '' }],
    checkpoints: [{ checkpointId: 'cp1', name: '集合点', counterBy: 'org1', status: 'open', note: '' }],
    latestPublication: null,
    publicationHistory: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

// src/db/teamActions.ts 绑定的是模块级单例 db；
// fake-indexeddb/auto 让全局 indexedDB 可用，因此直接 import 单例即可。
import {
  createTeam,
  acceptSubmission,
  decideSubmission,
  publishSnapshot,
  ingestPublication,
  acceptReceipt,
  getTeam,
  latestPublicationOf,
} from '../src/db/teamActions'
import { buildPublicSnapshot } from '../src/team/domain'
import type { PublicSnapshot } from '../src/team/schema'

async function testA01() {
  console.log('A01 旧数据升级保留')
  const db = new KnapsackDB()
  // 模拟 v1 老数据先写入再打开 v2
  await db.trips.put({
    format: 'trip.v1',
    id: 'oldtrip1',
    name: '旧旅行',
    startDate: '2026-01-01',
    endDate: '2026-01-02',
    destType: 'city',
    destCity: '',
    totalBudgetFen: 0,
    categoryBudgetsFen: {},
    members: [],
    days: [],
    expenses: [],
    packing: [],
    notes: '私人备忘 PRIVATE',
    enabledModules: { expenses: true, notes: true },
  } as never)
  const t = await db.trips.get('oldtrip1')
  check('旧 trip 保留', !!t && t.name === '旧旅行')
  // 团队表可写（v2 schema 已注册）
  const count = await db.teamState.count()
  check('teamState 表可用（空）', count === 0)
}

async function testA12_A13() {
  console.log('A12/A13 发布事务与幂等')
  const team = await createTeam({ name: '发布团', organizerName: '甲' })
  const teamId = team.teamId

  // 无 roster 变更直接发布（创建时有 organizer）
  const r1 = await publishSnapshot({
    teamId,
    organizerMemberId: 'nonexistent',
    operationId: 'op-p1',
    expectedDraftRevision: 1,
  })
  check('非组织者拒绝发布', !r1.ok)

  const r2 = await publishSnapshot({
    teamId,
    organizerMemberId: team.roster[0].memberId,
    operationId: 'op-p2',
    expectedDraftRevision: 1,
  })
  check('组织者首版发布成功', r2.ok && r2.version === 1)

  // A13：同 operationId 重试返回原版
  const r3 = await publishSnapshot({
    teamId,
    organizerMemberId: team.roster[0].memberId,
    operationId: 'op-p2',
    expectedDraftRevision: 1,
  })
  check('同 operationId 幂等返回原版 v1 不增版', r3.ok && r3.version === 1 && !r3.created !== true)

  // expected 过期：草稿变了
  const t = await getTeam(teamId)
  await publishSnapshot({
    teamId,
    organizerMemberId: team.roster[0].memberId,
    operationId: 'op-p3',
    expectedDraftRevision: t!.draftRevision + 99,
  }).then((res) => {
    check('expectedDraftRevision 过期拒绝', !res.ok)
  })

  // 第二版：先推进 draftRevision
  const t2 = await getTeam(teamId)
  t2!.draftRevision = 2
  const { saveTeam } = await import('../src/db/teamActions')
  await saveTeam(t2!)
  const r4 = await publishSnapshot({
    teamId,
    organizerMemberId: team.roster[0].memberId,
    operationId: 'op-p4',
    expectedDraftRevision: 2,
  })
  check('第二版 v2', r4.ok && r4.version === 2)

  // 旧发布快照不变（A13 前半：历史不变）
  const latest = await latestPublicationOf(teamId)
  check('最新指针指向 v2', latest?.version === 2)
  check('v1 与 v2 publicationId 不同', r2.ok && r4.ok && r2.publicationId !== r4.publicationId)
}

async function testSubmissionReceipt() {
  console.log('报告/回执幂等与单调')
  const team = await createTeam({ name: '回执团', organizerName: '甲' })
  const teamId = team.teamId
  const organizer = team.roster[0].memberId
  // createTeam 只建 organizer；报告作者补一名成员进名册
  const { saveTeam } = await import('../src/db/teamActions')
  team.roster.push({ memberId: 'm2', name: '乙', role: 'member', joinedAt: 2 })
  await saveTeam(team)
  const member = 'm2'

  // 提交报告（幂等）
  const draft = {
    submissionId: 'sub1',
    revision: 1,
    allocationId: 'a1',
    stage: 'purchase' as const,
    checkpointId: null,
    taskRevision: 1,
    qty: 24,
    amountFen: null,
    expenseReportId: null,
    payerMemberId: null,
    relatedAllocationIds: [],
    note: '',
  }
  const s1 = await acceptSubmission({ teamId, authorMemberId: member, operationId: 'op-s1', draft })
  check('报告接收成功', s1.ok)
  const s2 = await acceptSubmission({ teamId, authorMemberId: member, operationId: 'op-s1', draft })
  check('同 operationId 幂等重放', s2.ok && s1.ok && s2.submissionId === s1.submissionId)

  const draftBad = { ...draft, qty: 99 }
  const s3 = await acceptSubmission({ teamId, authorMemberId: member, operationId: 'op-s1', draft: draftBad })
  check('同 operationId 异载荷 conflict', !s3.ok && s3.conflict === true)

  // 确认报告
  const c1 = await decideSubmission({
    teamId, organizerMemberId: organizer, operationId: 'op-c1',
    submissionId: 'sub1', revision: 1, decision: 'confirmed',
  })
  check('组织者确认成功', c1.ok)
  const c2 = await decideSubmission({
    teamId, organizerMemberId: member, operationId: 'op-c2',
    submissionId: 'sub1', revision: 1, decision: 'confirmed',
  })
  check('非组织者确认拒绝', !c2.ok)

  // 发布第 1 版
  const p1 = await publishSnapshot({ teamId, organizerMemberId: organizer, operationId: 'op-pub1', expectedDraftRevision: (await getTeam(teamId))!.draftRevision })
  check('发布 v1', p1.ok && p1.version === 1)
  const snap1 = await latestPublicationOf(teamId)

  // 模拟成员设备首次领取：成员机上从未见过该发布，用成员侧视角的 publicationId
  // （测试中主机/成员共用同一 DB，故换 ID 走「新领取」分支）
  const memberSnap1: PublicSnapshot = { ...(snap1 as PublicSnapshot), publicationId: 'member-pub-1' }
  // 改了 publicationId 必须重算 digest：ingestPublication 现在会重算并比对，
  // 不自洽的快照会被拒（这正是要防的「假摘要」）。
  memberSnap1.digest = digestOf({ ...memberSnap1, digest: '' })
  const g1 = await ingestPublication({
    teamId, memberId: member,
    snapshot: memberSnap1,
    operationId: 'op-r1',
  })
  if (!g1.ok) console.error('  领取失败原因：', g1.error)
  check('领取成功且回执入队', g1.ok && g1.receiptQueued)

  // 同 publicationId 同内容幂等（重复下载不重复入队）
  const g2 = await ingestPublication({
    teamId, memberId: member,
    snapshot: memberSnap1,
    operationId: 'op-r1',
  })
  check('同 publicationId 幂等不重复', g2.ok && g2.version === 1)

  // 同 publicationId 异内容冲突
  const fakeSnap = { ...memberSnap1, digest: 'deadbeef:10' }
  const g3 = await ingestPublication({
    teamId, memberId: member,
    snapshot: fakeSnap,
    operationId: 'op-r9',
  })
  check('同 ID 异内容拒绝', !g3.ok)

  // 回执：主机幂等
  const r1 = await acceptReceipt({ teamId, memberId: member, operationId: 'op-r1', publicationId: memberSnap1.publicationId, version: 1 })
  check('回执记录 v1', r1.ok && r1.latestVersion === 1)
  const r2 = await acceptReceipt({ teamId, memberId: member, operationId: 'op-r1', publicationId: memberSnap1.publicationId, version: 1 })
  check('回执幂等重放', r2.ok && r2.latestVersion === 1)

  // 发布 v2（draftRevision 必须推进：expected 必须等于当前 draft）
  const tNow = await getTeam(teamId)
  tNow!.draftRevision = (tNow!.draftRevision ?? 1) + 1
  await saveTeam(tNow!)
  const p2 = await publishSnapshot({ teamId, organizerMemberId: organizer, operationId: 'op-pub2', expectedDraftRevision: tNow!.draftRevision })
  check('发布 v2', p2.ok && p2.version === 2)

  // A27：v1 的回执晚于 v2 到达，不降主机状态
  const rOld = await acceptReceipt({ teamId, memberId: member, operationId: 'op-r-old', publicationId: memberSnap1.publicationId, version: 1 })
  check('旧版回执不降级（latest 仍为该成员历史最大）', rOld.ok && rOld.latestVersion === 1)
  // 注意：latestVersion 是「该成员历史最大版本」；此时主机只见过 v1 回执，所以是 1。
  // 单调性由 max(历史, 新版本) 保证。下面领 v2、发 v2 回执后再验旧回执不降级。
  const snap2 = await latestPublicationOf(teamId)
  const memberSnap2: PublicSnapshot = { ...(snap2 as PublicSnapshot), publicationId: 'member-pub-2' }
  memberSnap2.digest = digestOf({ ...memberSnap2, digest: '' })
  const g4 = await ingestPublication({ teamId, memberId: member, snapshot: memberSnap2, operationId: 'op-r2' })
  check('领取 v2', g4.ok && g4.version === 2)
  const r3 = await acceptReceipt({ teamId, memberId: member, operationId: 'op-r2', publicationId: memberSnap2.publicationId, version: 2 })
  check('v2 回执 latest=2', r3.ok && r3.latestVersion === 2)
  // 再来一条更旧的 v1 回执（新 operationId），主机状态仍是 max=2
  const r4 = await acceptReceipt({ teamId, memberId: member, operationId: 'op-r-old2', publicationId: memberSnap1.publicationId, version: 1 })
  check('晚到的 v1 回执不把主机状态降回 1', r4.ok && r4.latestVersion === 2)
}

async function testExpenseLedger() {
  console.log('费用入账（A09/A11）')
  const { createTeam, acceptSubmission, decideSubmission, getTeam, saveTeam } = await import('../src/db/teamActions')
  const team = await createTeam({ name: '费用团', organizerName: '甲' })
  const teamId = team.teamId
  const organizer = team.roster[0].memberId
  team.roster.push({ memberId: 'm2', name: '乙', role: 'member', joinedAt: 2 })
  await saveTeam(team)

  const draft = {
    submissionId: 'exp1',
    revision: 1,
    allocationId: 'a1',
    stage: 'purchase' as const,
    checkpointId: null,
    taskRevision: 1,
    qty: 24,
    amountFen: 3600,
    expenseReportId: 'er-1',
    payerMemberId: 'm2',
    relatedAllocationIds: ['a1'],
    note: '矿泉水',
  }
  const s1 = await acceptSubmission({ teamId, authorMemberId: 'm2', operationId: 'op-e1', draft })
  check('费用报告接收', s1.ok)

  const before = await getTeam(teamId)
  check('待审时团队账本为空', before!.expenses.length === 0)

  const c1 = await decideSubmission({
    teamId, organizerMemberId: organizer, operationId: 'op-ec1',
    submissionId: 'exp1', revision: 1, decision: 'confirmed',
  })
  check('确认费用', c1.ok)
  const after = await getTeam(teamId)
  check('团队账本新增一笔 36 元', after!.expenses.length === 1 && after!.expenses[0].amountFen === 3600)
  const shares = after!.expenses[0].shares
  check('分摊总额等于金额', Object.values(shares).reduce((a, b) => a + b, 0) === 3600)
  check('实际付款人记为 m2', after!.expenses[0].payerMemberId === 'm2')

  // 修订为 40 元并确认：同一 expenseReportId 只保留一条（A09/A11）
  const draft2 = { ...draft, revision: 2, amountFen: 4000 }
  const s2 = await acceptSubmission({ teamId, authorMemberId: 'm2', operationId: 'op-e2', draft: draft2 })
  check('费用修订接收', s2.ok)
  const mid = await getTeam(teamId)
  check('修订待审时正式费用仍 36 元', mid!.expenses.length === 1 && mid!.expenses[0].amountFen === 3600)

  const c2 = await decideSubmission({
    teamId, organizerMemberId: organizer, operationId: 'op-ec2',
    submissionId: 'exp1', revision: 2, decision: 'confirmed',
  })
  check('确认修订', c2.ok)
  const final = await getTeam(teamId)
  check('同一来源只有一笔，金额变 40 元', final!.expenses.length === 1 && final!.expenses[0].amountFen === 4000)
}

// ---------- A34 回归：Vue 响应式 Proxy 传入 teamActions ----------

/** 把对象包成「深度响应式代理」，模拟视图层 reactive()/ref() 里取出来的形态（A34 的实际入参） */
function deepProxy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return new Proxy(value.map((v) => deepProxy(v)), {}) as unknown as T
  }
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) copy[k] = deepProxy(v)
  return new Proxy(copy, {}) as unknown as T
}

/** 递归找 Proxy / Date，返回命中路径（空数组 = 纯数据） */
function impurity(value: unknown, path = '$'): string[] {
  const hits: string[] = []
  if (value === null || typeof value !== 'object') return hits
  if (utilTypes.isProxy(value)) hits.push(path + '（Proxy）')
  if (value instanceof Date) hits.push(path + '（Date）')
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    hits.push(...impurity(v, path + '.' + k))
  }
  return hits
}

async function testA34ProxyToPlain() {
  console.log('A34 回归：Proxy 入参不再触发 DataCloneError')
  const { db } = await import('../src/db/index')
  const actions = await import('../src/db/teamActions')
  const { buildPublicSnapshot } = await import('../src/team/domain')

  // 0) 前提：本运行时的 structuredClone 拒绝 Proxy（浏览器 IndexedDB 的克隆同源行为）
  let cloneErr = ''
  try {
    structuredClone(new Proxy({ a: 1 }, {}))
  } catch (e) {
    cloneErr = e instanceof Error ? e.name + ': ' + e.message : String(e)
  }
  check('前提：structuredClone 拒绝 Proxy（' + (cloneErr || '未抛错') + '）', cloneErr.length > 0)

  // 1) 造团队（名册：甲组织者 + 乙成员）
  const team = await actions.createTeam({ name: 'Proxy 回归团', organizerName: '甲' })
  const teamId = team.teamId
  const organizer = team.roster[0].memberId
  team.roster.push({ memberId: 'm2', name: '乙', role: 'member', joinedAt: 2 })
  await actions.saveTeam(team)

  // 2) 快照：先取纯数据版，再包成深度代理（= TeamMemberTab 的 importPreview.value）
  const t0 = await actions.getTeam(teamId)
  const plainSnap = buildPublicSnapshot(t0!, 'pub-proxy-1', 1, 1000)
  const proxiedSnap = deepProxy(plainSnap)

  // 2a) 负对照：直接 put 代理会抛 DataCloneError（A34 修复前的失败路径）
  let rawErr = ''
  try {
    await db.teamPublications.put({
      publicationId: 'pub-raw-proxy',
      meta: {
        teamId,
        publicationId: 'pub-raw-proxy',
        version: 1,
        createdAt: 1,
        digest: plainSnap.digest,
        sourceDraftRevision: 1,
      },
      snapshot: proxiedSnap,
    })
  } catch (e) {
    rawErr = e instanceof Error ? e.name + ': ' + e.message : String(e)
  }
  if (rawErr) {
    check('负对照：直接 put 代理快照被拒绝（' + rawErr + '）', /clon/i.test(rawErr))
    check('负对照失败后没有残留行', !(await db.teamPublications.get('pub-raw-proxy')))
  } else {
    console.log('  note 负对照：fake-indexeddb 未拒绝 Proxy（真实浏览器 IndexedDB 会抛 DataCloneError；以 structuredClone 前提为准）')
    await db.teamPublications.delete('pub-raw-proxy')
  }

  // 3) 修复后：ingestPublication 收代理快照
  const g1 = await actions.ingestPublication({
    teamId,
    memberId: organizer,
    snapshot: proxiedSnap,
    operationId: 'op-proxy-ingest',
    queueReceipt: false,
  })
  check('ingestPublication(代理快照) 成功且版本=1', g1.ok && g1.version === 1)
  const row = await db.teamPublications.get('pub-proxy-1')
  check('快照已入库', !!row && row.snapshot.version === 1)
  const rowImpurity = impurity(row?.snapshot)
  check('入库快照是纯数据（无 Proxy/Date）' + (rowImpurity.length ? ' → ' + rowImpurity.join(', ') : ''), rowImpurity.length === 0)
  check('入库快照与原始纯数据一致', JSON.stringify(row?.snapshot) === JSON.stringify(plainSnap))

  // 4) 幂等：同 operationId 用代理重放，不重复入队
  const g2 = await actions.ingestPublication({
    teamId,
    memberId: organizer,
    snapshot: proxiedSnap,
    operationId: 'op-proxy-ingest',
    queueReceipt: false,
  })
  check('同 operationId 代理重放成功且不重复入队', g2.ok && g2.version === 1 && g2.receiptQueued === false)

  // 5) acceptSubmission：代理 draft
  const plainDraft = {
    submissionId: 'sub-proxy',
    revision: 1,
    teamId,
    allocationId: null,
    stage: 'purchase' as const,
    checkpointId: null,
    taskRevision: 1,
    qty: 24,
    amountFen: 3600,
    expenseReportId: 'er-proxy',
    payerMemberId: 'm2',
    relatedAllocationIds: [] as string[],
    note: '代理草稿',
  }
  const proxiedDraft = deepProxy(plainDraft)
  const s1 = await actions.acceptSubmission({
    teamId,
    authorMemberId: organizer,
    operationId: 'op-proxy-sub',
    draft: proxiedDraft,
  })
  check('acceptSubmission(代理 draft) 成功', s1.ok)
  const t1 = await actions.getTeam(teamId)
  const sub = t1!.submissions.find((s) => s.submissionId === 'sub-proxy')
  check('报告已入库且是纯数据', !!sub && impurity(sub).length === 0)
  check('报告内容一致（qty/amountFen/note）', !!sub && sub.qty === 24 && sub.amountFen === 3600 && sub.note === '代理草稿')

  // 6) publishSnapshot：代理 itinerary
  const plainItinerary = {
    title: 'P7 行程',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    days: [{ date: '2026-11-01', items: [{ time: null, type: 'transport' as const, title: '出发', note: '' }] }],
  }
  const proxiedItinerary = deepProxy(plainItinerary)
  const t2 = await actions.getTeam(teamId)
  const p1 = await actions.publishSnapshot({
    teamId,
    organizerMemberId: organizer,
    operationId: 'op-proxy-pub',
    expectedDraftRevision: t2!.draftRevision,
    itinerary: proxiedItinerary,
  })
  check('publishSnapshot(代理 itinerary) 成功', p1.ok)
  const pub = p1.ok ? await db.teamPublications.get(p1.publicationId) : undefined
  const itinImpurity = impurity(pub?.snapshot.itinerary)
  check('发布快照的 itinerary 是纯数据' + (itinImpurity.length ? ' → ' + itinImpurity.join(', ') : ''), !!pub && itinImpurity.length === 0)
  check('itinerary 内容一致', !!pub && JSON.stringify(pub.snapshot.itinerary) === JSON.stringify(plainItinerary))

  // 7) toPlain 语义假设（写清楚，防以后有人往这三类入参里塞 Date）
  const dateRoundTrip = JSON.parse(JSON.stringify({ d: new Date(0) })) as { d: unknown }
  check('假设：JSON 往返把 Date 变成字符串（实测 ' + typeof dateRoundTrip.d + '）→ 这三类入参不得含 Date', typeof dateRoundTrip.d === 'string')
  check(
    '假设：快照/报告/itinerary 本身确实不含 Date',
    impurity(plainSnap).length === 0 && impurity(plainDraft).length === 0 && impurity(plainItinerary).length === 0,
  )
}

// ---------- SPEC 3.3：同一逻辑键只允许一条 confirmed ----------

async function testConfirmKeyUniqueness() {
  console.log('逻辑键唯一（SPEC 3.3 / A06）')
  const { createTeam, acceptSubmission, decideSubmission, getTeam } = await import('../src/db/teamActions')
  const { currentConfirmedQty } = await import('../src/team/domain')
  const { confirmKeyString } = await import('../src/team/protocol')

  const { saveTeam } = await import('../src/db/teamActions')
  const base = await createTeam({ name: '逻辑键团', organizerName: '甲' })
  // 造一个真实存在的物资与批次 a1（否则报告会指向不存在的分配）
  const team = await saveTeam({
    ...base,
    items: [{ itemId: 'item1', name: '水', category: 'food', qtyNeeded: 24, unit: '瓶', note: '' }],
    allocations: [{ allocationId: 'a1', itemId: 'item1', qtyPlanned: 24, purchaseBy: base.roster[0]!.memberId, carryBy: null, note: '' }],
  })
  const org = team.roster.find((m) => m.role === 'organizer')!.memberId
  const key = confirmKeyString({ allocationId: 'a1', stage: 'purchase', checkpointId: null })

  // 同一批次的采购环节，两个不同来源各报一个数
  const draft = (sid: string, qty: number) => ({
    submissionId: sid,
    revision: 1,
    teamId: team.teamId,
    allocationId: 'a1',
    stage: 'purchase' as const,
    checkpointId: null,
    taskRevision: team.draftRevision,
    qty,
    amountFen: null,
    expenseReportId: null,
    payerMemberId: null,
    relatedAllocationIds: ['a1'],
    note: '',
  })
  const a1 = await acceptSubmission({ teamId: team.teamId, authorMemberId: org, operationId: 'k-o1', draft: draft('K1', 20) })
  const a2 = await acceptSubmission({ teamId: team.teamId, authorMemberId: org, operationId: 'k-o2', draft: draft('K2', 24) })
  check('两条不同来源的报告都能接收', a1.ok && a2.ok)

  const d1 = await decideSubmission({ teamId: team.teamId, organizerMemberId: org, operationId: 'k-d1', submissionId: 'K1', revision: 1, decision: 'confirmed' })
  check('先确认 K1=20', d1.ok)

  const after1 = await getTeam(team.teamId)
  check('确认后该键有唯一确认量 20', currentConfirmedQty(after1!.submissions).get(key)?.qty === 20)

  // 再确认 K2：同键旧来源必须让位，不能出现两个"当前确认量"
  const d2 = await decideSubmission({ teamId: team.teamId, organizerMemberId: org, operationId: 'k-d2', submissionId: 'K2', revision: 1, decision: 'confirmed' })
  check('再确认 K2=24', d2.ok)

  const after2 = await getTeam(team.teamId)
  const stillConfirmed = after2!.submissions.filter((s) => s.review === 'confirmed' && s.allocationId === 'a1' && s.stage === 'purchase')
  check('同一逻辑键只剩一条 confirmed（SPEC 3.3 替换语义）', stillConfirmed.length === 1)
  check('被取代的 K1 标记为 stale', after2!.submissions.find((s) => s.submissionId === 'K1')!.review === 'stale')
  check('当前确认量确定为 24（不随 reviewedAt/顺序漂移）', currentConfirmedQty(after2!.submissions).get(key)?.qty === 24)
  const { buildPublicSnapshot } = await import('../src/team/domain')
  const snap = buildPublicSnapshot(after2!, 'p', 1, 1)
  const alloc = snap.items.flatMap((it) => it.allocations).find((a) => a.allocationId === 'a1')
  check('快照存在该批次', alloc !== undefined)
  check(
    '快照只含一个采购确认来源',
    (alloc?.confirmed ?? []).filter((r) => r.stage === 'purchase').length === 1,
  )

  // 退回不该把别的来源拉回 confirmed
  const d3 = await decideSubmission({ teamId: team.teamId, organizerMemberId: org, operationId: 'k-d3', submissionId: 'K2', revision: 1, decision: 'rejected' })
  const after3 = await getTeam(team.teamId)
  check('退回 K2 后该键无确认量（不会复活 K1）', !currentConfirmedQty(after3!.submissions).has(key))
  check('退回不影响幂等返回', d3.ok)
}

// ---------- A08：分工更新后旧版本报告标 stale ----------

async function testStaleOnDraftBump() {
  console.log('分工更新标记 stale（A08）')
  const { createTeam, acceptSubmission, decideSubmission, saveTeam, getTeam } = await import('../src/db/teamActions')
  const { currentConfirmedQty } = await import('../src/team/domain')
  const { confirmKeyString } = await import('../src/team/protocol')

  const team = await createTeam({ name: '过期报告团', organizerName: '甲' })
  const org = team.roster.find((m) => m.role === 'organizer')!.memberId
  const key = confirmKeyString({ allocationId: 'a1', stage: 'purchase', checkpointId: null })

  const s1 = await acceptSubmission({
    teamId: team.teamId,
    authorMemberId: org,
    operationId: 'st-o1',
    draft: {
      submissionId: 'ST1', revision: 1, teamId: team.teamId, allocationId: 'a1',
      stage: 'purchase', checkpointId: null, taskRevision: team.draftRevision,
      qty: 24, amountFen: null, expenseReportId: null, payerMemberId: null,
      relatedAllocationIds: ['a1'], note: '',
    },
  })
  check('接收报告', s1.ok)
  await decideSubmission({ teamId: team.teamId, organizerMemberId: org, operationId: 'st-d1', submissionId: 'ST1', revision: 1, decision: 'confirmed' })
  let cur = await getTeam(team.teamId)
  check('确认后进入当前确认量', currentConfirmedQty(cur!.submissions).get(key)?.qty === 24)

  // 组织者改了分工（推进 draftRevision）
  cur = await saveTeam({ ...cur!, draftRevision: cur!.draftRevision + 1 })
  check('draftRevision 已推进', cur.draftRevision === team.draftRevision + 1)

  const stale = cur.submissions.find((s) => s.submissionId === 'ST1')!
  check('旧版本报告被标记 stale（A08）', stale.review === 'stale')
  check('stale 报告不进当前确认量', !currentConfirmedQty(cur.submissions).has(key))
  check('stale 备注说明原因', stale.reviewNote.includes('分工已更新'))

  // 再次保存（revision 未变）不应把已 stale 的报告改回别的状态
  const again = await saveTeam({ ...cur, draftRevision: cur.draftRevision })
  check('重复保存不改变 stale 状态', again.submissions.find((s) => s.submissionId === 'ST1')!.review === 'stale')
}
// ---------- SPEC 3.5：费用来源编号的作者独占性（防静默覆盖丢钱） ----------

async function testExpenseReportIdOwnership() {
  console.log('费用来源编号独占（SPEC 3.5 / A15）')
  const { createTeam, saveTeam, acceptSubmission, decideSubmission, getTeam } = await import('../src/db/teamActions')

  const base = await createTeam({ name: '独占团', organizerName: '甲' })
  const team = await saveTeam({
    ...base,
    roster: [
      { memberId: 'org1', name: '甲', role: 'organizer', joinedAt: 1 },
      { memberId: 'm2', name: '乙', role: 'member', joinedAt: 2 },
      { memberId: 'm3', name: '丙', role: 'member', joinedAt: 3 },
    ],
  })
  const draft = (sid: string, author: string, fee: string, amt: number) => ({
    submissionId: sid,
    revision: 1,
    teamId: team.teamId,
    allocationId: 'a1',
    stage: 'purchase' as const,
    checkpointId: null,
    taskRevision: team.draftRevision,
    qty: 24,
    amountFen: amt,
    expenseReportId: fee,
    payerMemberId: author,
    relatedAllocationIds: ['a1'],
    note: '买水',
  })

  const a1 = await acceptSubmission({ teamId: team.teamId, authorMemberId: 'm2', operationId: 'own-1', draft: draft('S-m2', 'm2', 'er-same', 3600) })
  check('m2 建立费用来源 er-same', a1.ok)

  // m3 复用同一个编号：必须拒绝，否则入账时会按 ID 覆盖，静默丢掉 m2 那笔
  const a2 = await acceptSubmission({ teamId: team.teamId, authorMemberId: 'm3', operationId: 'own-2', draft: draft('S-m3', 'm3', 'er-same', 9900) })
  check('他人复用费用来源编号被拒绝', !a2.ok && (a2.error ?? '').includes('其他成员'))

  // 同一作者重传同一 submissionId：报的是 revision 规则，不是独占冲突
  // （证明校验没有误伤自己的重试路径）
  const a3 = await acceptSubmission({ teamId: team.teamId, authorMemberId: 'm2', operationId: 'own-3', draft: draft('S-m2', 'm2', 'er-same', 3600) })
  check('同一作者重传不触发独占冲突', !(a3.error ?? '').includes('其他成员'))
  check('同一作者重传按 revision 规则处理', !a3.ok && (a3.error ?? '').includes('revision'))

  // 同一作者用新 submissionId + 同编号修订：同样不应触发独占冲突
  const a4 = await acceptSubmission({ teamId: team.teamId, authorMemberId: 'm2', operationId: 'own-4', draft: draft('S-m2-r2', 'm2', 'er-same', 4000) })
  check('同一作者换 submissionId 用同编号不触发独占冲突', a4.ok || !(a4.error ?? '').includes('其他成员'))

  // 确认后账本里只有 m2 那笔，金额没被顶掉
  await decideSubmission({ teamId: team.teamId, organizerMemberId: 'org1', operationId: 'own-d1', submissionId: 'S-m2', revision: 1, decision: 'confirmed' })
  const after = await getTeam(team.teamId)
  check('账本保留 m2 的 3600 分（未被 9900 覆盖）', after!.expenses.length === 1 && after!.expenses[0]!.amountFen === 3600)
  check('作者与付款人都是 m2', after!.expenses[0]!.authorMemberId === 'm2' && after!.expenses[0]!.payerMemberId === 'm2')
}

// ---------- SPEC 3.5：正式数据校验成员存在 ----------

async function testExpenseMemberValidation() {
  console.log('费用入账成员校验（SPEC 3.5）')
  const { createTeam, acceptSubmission, decideSubmission, getTeam } = await import('../src/db/teamActions')

  const team = await createTeam({ name: '成员校验团', organizerName: '甲' })
  const org = team.roster.find((m) => m.role === 'organizer')!.memberId

  // 付款人不在名册
  const bad = await acceptSubmission({
    teamId: team.teamId,
    authorMemberId: org,
    operationId: 'mem-1',
    draft: {
      submissionId: 'M1', revision: 1, teamId: team.teamId, allocationId: 'a1',
      stage: 'purchase', checkpointId: null, taskRevision: team.draftRevision,
      qty: 24, amountFen: 3600, expenseReportId: 'er-ghost', payerMemberId: 'GHOST-USER',
      relatedAllocationIds: ['a1'], note: '买水',
    },
  })
  check('报告本身能接收（作者合法）', bad.ok)

  const r = await decideSubmission({ teamId: team.teamId, organizerMemberId: org, operationId: 'mem-d1', submissionId: 'M1', revision: 1, decision: 'confirmed' })
  check('确认被拒绝：付款人不在名册', !r.ok && (r.error ?? '').includes('名册'))

  const after = await getTeam(team.teamId)
  check('账本没有这条幽灵记录', after!.expenses.length === 0)

  // 付款人留空 → 回退到作者（作者此时在名册，应放行）
  const ok = await acceptSubmission({
    teamId: team.teamId,
    authorMemberId: org,
    operationId: 'mem-2',
    draft: {
      submissionId: 'M2', revision: 1, teamId: team.teamId, allocationId: 'a1',
      stage: 'purchase', checkpointId: null, taskRevision: team.draftRevision,
      qty: 24, amountFen: 3600, expenseReportId: 'er-ok', payerMemberId: null,
      relatedAllocationIds: ['a1'], note: '买水',
    },
  })
  check('付款人为空时回退作者，可接收', ok.ok)
  const r2 = await decideSubmission({ teamId: team.teamId, organizerMemberId: org, operationId: 'mem-d2', submissionId: 'M2', revision: 1, decision: 'confirmed' })
  check('确认通过', r2.ok)
  const after2 = await getTeam(team.teamId)
  check('入账且付款人=作者', after2!.expenses.length === 1 && after2!.expenses[0]!.payerMemberId === org)
  check('shares 总和等于金额', Object.values(after2!.expenses[0]!.shares).reduce((a, b) => a + b, 0) === 3600)
}
// ---------- 列表投影：只带展示字段，不带大数组 ----------

async function testTeamListProjection() {
  console.log('团队列表投影（内存优化）')
  const { createTeam, saveTeam, listTeamSummaries } = await import('../src/db/teamActions')

  const base = await createTeam({ name: '投影团', organizerName: '甲' })
  const team = await saveTeam({
    ...base,
    roster: [
      { memberId: 'org1', name: '甲', role: 'organizer', joinedAt: 1 },
      { memberId: 'm2', name: '乙', role: 'member', joinedAt: 2 },
    ],
    items: [{ itemId: 'i1', name: '水', category: 'food', qtyNeeded: 24, unit: '瓶', note: '' }],
    allocations: [{ allocationId: 'a1', itemId: 'i1', qtyPlanned: 24, purchaseBy: 'm2', carryBy: null, note: '' }],
    checkpoints: [{ checkpointId: 'cp1', name: '集合点', counterBy: 'org1', status: 'open', note: '' }],
    submissions: [
      {
        submissionId: 's1', revision: 1, teamId: base.teamId, authorMemberId: 'm2',
        allocationId: 'a1', stage: 'purchase', checkpointId: null, taskRevision: 1,
        qty: 24, amountFen: null, expenseReportId: null, payerMemberId: null,
        relatedAllocationIds: [], note: '', uploadedAt: 1, review: 'submitted',
        reviewNote: '', reviewedAt: null,
      },
    ] as any,
  })

  const list = await listTeamSummaries()
  const row = list.find((t) => t.teamId === team.teamId)!
  check('投影含 teamId 与名称', row.teamId === team.teamId && row.name === '投影团')
  check('投影保留 roster（列表要数人数）', row.roster.length === 2)
  check('投影保留 items/allocations/checkpoints 计数', row.items.length === 1 && row.allocations.length === 1 && row.checkpoints.length === 1)
  check('投影不含 submissions（大数组）', !('submissions' in row))
  check('投影不含 expenses（大数组）', !('expenses' in row))
  check('投影不含 pendingJoins', !('pendingJoins' in row))
  check('投影不含 credentialSecret（安全）', !('credentialSecret' in row))
  check('投影保留 latestPublication 字段', 'latestPublication' in row)

  // 序列化体积对比：投影应该显著小于完整聚合根
  const fullJson = JSON.stringify(team).length
  const rowJson = JSON.stringify(row).length
  check('投影序列化后不大于完整版', rowJson <= fullJson)
}
// ---------- P0 修复回归：并发幂等 / 载荷毒化 / 旧版报告 / 假回执 / 假摘要 ----------

async function testP0Regressions() {
  console.log('P0 修复回归')

  // (1) 同一 operationId 并发发布 -> 只发一版
  {
    const { createTeam, publishSnapshot, getTeam } = await import('../src/db/teamActions')
    const t = await createTeam({ name: '并发团', organizerName: '甲' })
    const org = t.roster.find((m) => m.role === 'organizer')!.memberId
    const opId = 'concurrent-op'
    const [a, b] = await Promise.all([
      publishSnapshot({ teamId: t.teamId, organizerMemberId: org, operationId: opId, expectedDraftRevision: t.draftRevision }),
      publishSnapshot({ teamId: t.teamId, organizerMemberId: org, operationId: opId, expectedDraftRevision: t.draftRevision }),
    ])
    const after = await getTeam(t.teamId)
    check('并发同 operationId 只发一版', after!.publicationHistory.length === 1)
    check('两个请求返回同一 publicationId', a.ok && b.ok && a.publicationId === b.publicationId)
  }

  // (2) 畸形载荷不得毒化聚合根
  {
    const { createTeam, acceptSubmission, getTeam } = await import('../src/db/teamActions')
    const t = await createTeam({ name: '毒化团', organizerName: '甲' })
    const org = t.roster.find((m) => m.role === 'organizer')!.memberId
    const bad = await acceptSubmission({
      teamId: t.teamId, authorMemberId: org, operationId: 'bad-op',
      draft: {
        submissionId: 'BAD', revision: 'NOT_A_NUMBER' as never, teamId: t.teamId,
        allocationId: 'a1', stage: 'purchase', checkpointId: null, taskRevision: 1,
        qty: -999 as never, amountFen: null, expenseReportId: null, payerMemberId: null,
        relatedAllocationIds: [], note: '',
      },
    })
    check('畸形载荷被拒绝', !bad.ok)
    let readable = true
    try { await getTeam(t.teamId) } catch { readable = false }
    check('聚合根仍可读（未被毒化）', readable)
  }

  // (3) 依据旧版分工的报告 -> stale，不进待审核
  {
    const { createTeam, saveTeam, acceptSubmission, getTeam } = await import('../src/db/teamActions')
    const base = await createTeam({ name: '旧版团', organizerName: '甲' })
    const org = base.roster.find((m) => m.role === 'organizer')!.memberId
    const t = await saveTeam({ ...base, draftRevision: 5 })
    const r = await acceptSubmission({
      teamId: t.teamId, authorMemberId: org, operationId: 'old-op',
      draft: {
        submissionId: 'OLD', revision: 1, teamId: t.teamId, allocationId: 'a1',
        stage: 'purchase', checkpointId: null, taskRevision: 1, qty: 20,
        amountFen: null, expenseReportId: null, payerMemberId: null,
        relatedAllocationIds: ['a1'], note: '',
      },
    })
    check('旧版报告仍能接收（不丢数据）', r.ok)
    const after = await getTeam(t.teamId)
    check('旧版报告落为 stale 而非 submitted', after!.submissions[0]!.review === 'stale')
    check('stale 备注说明原因', after!.submissions[0]!.reviewNote.includes('已过期'))
  }

  // (4) 假回执被拒
  {
    const { createTeam, acceptReceipt } = await import('../src/db/teamActions')
    const t = await createTeam({ name: '假回执团', organizerName: '甲' })
    const r = await acceptReceipt({
      teamId: t.teamId, memberId: 'm2', operationId: 'fake-receipt',
      publicationId: '不存在的发布', version: 999999,
    })
    check('指向不存在发布的回执被拒', !r.ok)
  }

  // (5) 假摘要快照被拒
  {
    const { createTeam, ingestPublication } = await import('../src/db/teamActions')
    const { publicSnapshotSchema } = await import('../src/team/schema')
    const t = await createTeam({ name: '假摘要团', organizerName: '甲' })
    const snap = publicSnapshotSchema.parse({
      format: 'team-publication.v1', teamId: t.teamId, publicationId: 'P1', version: 1,
      sourceDraftRevision: 1, createdAt: Date.now(), digest: 'deadbeef:10',
      roster: t.roster, itinerary: null, items: [], checkpoints: [], expenses: [], assignments: [],
    })
    const r = await ingestPublication({
      teamId: t.teamId, memberId: t.roster[0]!.memberId, snapshot: snap,
      operationId: 'fake-digest', queueReceipt: false,
    })
    check('摘要不符的快照被拒', !r.ok)
  }
}
async function main() {
  await testA01()
  await testA12_A13()
  await testSubmissionReceipt()
  await testExpenseLedger()
  await testConfirmKeyUniqueness()
  await testStaleOnDraftBump()
  await testExpenseReportIdOwnership()
  await testExpenseMemberValidation()
  await testTeamListProjection()
  await testP0Regressions()
  await testA34ProxyToPlain()
  if (failed > 0) {
    console.error(`\n${failed} 项失败`)
    process.exit(1)
  } else {
    console.log('\n全部通过')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
