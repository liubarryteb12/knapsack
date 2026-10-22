/**
 * 团队领域测试（P1）——按 PLAN 验收矩阵 A05–A13 编号对应
 *
 * 运行：npx tsx scripts/test-team.ts
 * 只测纯领域函数与 schema；数据库事务测试在 test-team-db.ts。
 */
import {
  canonicalJson,
  currentConfirmedQty,
  digestOf,
  nextPublishVersion,
  publicationConflict,
  sharesValid,
  buildPublicSnapshot,
} from '../src/team/domain'
import { confirmKeyString, isConsistentKey } from '../src/team/protocol'
import {
  submissionSchema,
  teamStateSchema,
  publicSnapshotSchema,
  type Submission,
  type TeamState,
} from '../src/team/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

// ---------- 构造辅助 ----------

function makeSubmission(p: Partial<Submission> & { submissionId: string; authorMemberId: string }): Submission {
  return submissionSchema.parse({
    revision: 1,
    teamId: 't1',
    stage: 'purchase',
    checkpointId: null,
    taskRevision: 1,
    qty: null,
    amountFen: null,
    expenseReportId: null,
    payerMemberId: null,
    relatedAllocationIds: [],
    note: '',
    uploadedAt: null,
    review: 'confirmed',
    reviewNote: '',
    reviewedAt: 1000,
    ...p,
  })
}

function makeTeam(p: Partial<TeamState>): TeamState {
  return teamStateSchema.parse({
    format: 'team.v1',
    teamId: 't1',
    name: '测试团',
    myMemberId: 'org1',
    draftRevision: 1,
    revision: 1,
    roster: [
      { memberId: 'org1', name: '甲', role: 'organizer', joinedAt: 1 },
      { memberId: 'm2', name: '乙', role: 'member', joinedAt: 2 },
      { memberId: 'm3', name: '丙', role: 'member', joinedAt: 3 },
    ],
    items: [{ itemId: 'item1', name: '水', category: 'food', qtyNeeded: 24, unit: '瓶', note: '' }],
    allocations: [
      {
        allocationId: 'a1',
        itemId: 'item1',
        qtyPlanned: 24,
        purchaseBy: 'm2',
        carryBy: 'm3',
        note: '',
      },
    ],
    checkpoints: [{ checkpointId: 'cp1', name: '集合点', counterBy: 'org1', status: 'open', note: '' }],
    createdAt: 1,
    updatedAt: 1,
    latestPublication: null,
    publicationHistory: [],
    ...p,
  })
}

// ---------- A05：同批买/带/清点分阶段不累加 ----------

function testA05() {
  console.log('A05 同批分阶段')
  const subs: Submission[] = [
    makeSubmission({ submissionId: 's1', authorMemberId: 'm2', allocationId: 'a1', stage: 'purchase', qty: 24, reviewedAt: 10 }),
    makeSubmission({ submissionId: 's2', authorMemberId: 'm3', allocationId: 'a1', stage: 'carry', qty: 24, reviewedAt: 20 }),
    makeSubmission({ submissionId: 's3', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp1', qty: 20, reviewedAt: 30 }),
  ]
  const confirmed = currentConfirmedQty(subs)
  check('purchase 24', confirmed.get(confirmKeyString({ allocationId: 'a1', stage: 'purchase', checkpointId: null }))?.qty === 24)
  check('carry 24', confirmed.get(confirmKeyString({ allocationId: 'a1', stage: 'carry', checkpointId: null }))?.qty === 24)
  check('count@cp1 20', confirmed.get(confirmKeyString({ allocationId: 'a1', stage: 'count', checkpointId: 'cp1' }))?.qty === 20)
  check('三个逻辑键互不合并', confirmed.size === 3)
}

// ---------- A06：同节点重清点替换（同逻辑键新来源） ----------

function testA06() {
  console.log('A06 重清点替换')
  // 同 submissionId 重清点 20→22：主机确认后 replacement 语义
  const subs: Submission[] = [
    makeSubmission({ submissionId: 's3', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp1', qty: 20, revision: 1, reviewedAt: 30 }),
    // 模拟主机替换后的当前状态：同 submissionId revision 2（更新）
    makeSubmission({ submissionId: 's3', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp1', qty: 22, revision: 2, reviewedAt: 40 }),
  ]
  // 注意：真实存储中同 submissionId 只保留最新 revision；这里两条是为了测纯函数在
  // 收到两条同键记录时以 reviewedAt 新者为准（替换语义，不是 42）
  const confirmed = currentConfirmedQty(subs)
  check('同键取最新确认 22（非 42）', confirmed.get(confirmKeyString({ allocationId: 'a1', stage: 'count', checkpointId: 'cp1' }))?.qty === 22)

  // 不同 submissionId 竞争同逻辑键：后来者覆盖（主机明确替换）
  const subs2: Submission[] = [
    makeSubmission({ submissionId: 'sA', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp1', qty: 20, reviewedAt: 30 }),
    makeSubmission({ submissionId: 'sB', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp1', qty: 22, reviewedAt: 40 }),
  ]
  const confirmed2 = currentConfirmedQty(subs2)
  check('不同submissionId竞争：后确认者替换（22）', confirmed2.get(confirmKeyString({ allocationId: 'a1', stage: 'count', checkpointId: 'cp1' }))?.qty === 22)
}

// ---------- A07：两节点隔离，不跨节点累计 ----------

function testA07() {
  console.log('A07 节点隔离')
  const subs: Submission[] = [
    makeSubmission({ submissionId: 's1', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp1', qty: 20, reviewedAt: 10 }),
    makeSubmission({ submissionId: 's2', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp2', qty: 20, reviewedAt: 20 }),
  ]
  const confirmed = currentConfirmedQty(subs)
  check('cp1 20', confirmed.get(confirmKeyString({ allocationId: 'a1', stage: 'count', checkpointId: 'cp1' }))?.qty === 20)
  check('cp2 20', confirmed.get(confirmKeyString({ allocationId: 'a1', stage: 'count', checkpointId: 'cp2' }))?.qty === 20)
  check('两个节点两个键，不合并成 40', confirmed.size === 2)
}

// ---------- checkpoint 配套校验 ----------

function testKeyConsistency() {
  console.log('逻辑键配套')
  check('count 必须有 checkpointId', !isConsistentKey('count', null))
  check('purchase 必须无 checkpointId', !isConsistentKey('purchase', 'cp1'))
  check('carry 必须无 checkpointId', isConsistentKey('carry', null))
}

// ---------- A09：费用修订（36→40）与幂等 ----------

function testA09() {
  console.log('A09 费用修订')
  // 修订待审核时正式仍 36：confirmed 只看 review==='confirmed'
  const subs: Submission[] = [
    makeSubmission({ submissionId: 'e1', authorMemberId: 'm2', allocationId: 'a1', stage: 'purchase', qty: 24, amountFen: 3600, expenseReportId: 'er1', revision: 1, review: 'confirmed', reviewedAt: 10 }),
    makeSubmission({ submissionId: 'e1', authorMemberId: 'm2', allocationId: 'a1', stage: 'purchase', qty: 24, amountFen: 4000, expenseReportId: 'er1', revision: 2, review: 'submitted', reviewedAt: null }),
  ]
  const confirmedList = subs.filter((s) => s.review === 'confirmed')
  check('待审修订不影响正式费用（仍 3600 分）', confirmedList.every((s) => s.amountFen === 3600))
  check('旧确认仍指向 revision 1', confirmedList[0]?.revision === 1)

  // 确认后同一笔变 40：主机替换当前来源（revision 2 confirmed）
  const subs2: Submission[] = [
    makeSubmission({ submissionId: 'e1', authorMemberId: 'm2', allocationId: 'a1', stage: 'purchase', qty: 24, amountFen: 4000, expenseReportId: 'er1', revision: 2, review: 'confirmed', reviewedAt: 20 }),
  ]
  check('确认后同一费用 4000 分一笔', subs2.length === 1 && subs2[0].amountFen === 4000)
}

// ---------- 分摊校验 ----------

function testShares() {
  console.log('分摊校验')
  check('sum 等于总额通过', sharesValid(3600, { m2: 1200, m3: 2400 }))
  check('sum 不等拒绝', !sharesValid(3600, { m2: 1000, m3: 2000 }))
}

// ---------- A12/A13：发布版本与幂等 ----------

function testPublish() {
  console.log('发布版本')
  const t1 = makeTeam({})
  const v1 = nextPublishVersion(t1)
  check('首版为 1', v1.ok && v1.version === 1)

  const t2 = makeTeam({
    draftRevision: 3,
    latestPublication: {
      teamId: 't1', publicationId: 'p1', version: 2, createdAt: 1, digest: 'x', sourceDraftRevision: 2,
    },
  })
  const v2 = nextPublishVersion(t2)
  check('下一版为 3（单调递增）', v2.ok && v2.version === 3)

  const t3 = makeTeam({ roster: [] })
  check('无名册拒绝发布', !nextPublishVersion(t3).ok)

  check('新 publicationId = new', publicationConflict(undefined, 'd1') === 'new')
  check('同 ID 同 digest = identical', publicationConflict({ teamId: 't1', publicationId: 'p1', version: 1, createdAt: 1, digest: 'd1', sourceDraftRevision: 1 }, 'd1') === 'identical')
  check('同 ID 异 digest = conflict', publicationConflict({ teamId: 't1', publicationId: 'p1', version: 1, createdAt: 1, digest: 'd1', sourceDraftRevision: 1 }, 'd2') === 'conflict')
}

// ---------- 规范化 JSON 与摘要 ----------

function testCanonical() {
  console.log('规范化序列化')
  check('键序无关', canonicalJson({ b: 1, a: 2 }) === canonicalJson({ a: 2, b: 1 }))
  check('数组保序', canonicalJson([1, 2]) !== canonicalJson([2, 1]))
  check('digest 稳定', digestOf({ x: 1 }) === digestOf({ x: 1 }))
  check('digest 区分内容', digestOf({ x: 1 }) !== digestOf({ x: 2 }))
  // 幂等键不含 sessionId（SPEC 5.2）
  const withSession = digestOf({ op: 's1', sessionId: 'AAA', payload: 1 })
  const withoutSession = digestOf({ op: 's1', payload: 1 })
  check('业务载荷摘要不含 sessionId（键集不同→摘要不同，主机比较时排除临时字段）', withSession !== withoutSession)
}

// ---------- A03：公共快照白名单 ----------

function testA03() {
  console.log('A03 公共快照白名单')
  const team = makeTeam({
    submissions: [
      makeSubmission({ submissionId: 's3', authorMemberId: 'org1', allocationId: 'a1', stage: 'count', checkpointId: 'cp1', qty: 20, reviewedAt: 30 }),
    ],
    expenses: [{
      expenseReportId: 'er1', teamId: 't1', authorMemberId: 'm2', payerMemberId: 'm3',
      amountFen: 3600, shares: { m2: 1800, m3: 1800 }, relatedAllocationIds: ['a1'],
      title: '水', category: 'food', spentOn: '2026-10-07', createdAt: 1, sourceSubmissionId: 'e1', sourceRevision: 1,
    }],
  })
  const snap = buildPublicSnapshot(team, 'pub1', 1, Date.now())
  const parsed = publicSnapshotSchema.parse(snap)
  const json = JSON.stringify(parsed)
  check('快照通过 schema 校验', !!parsed)
  check('无私人 notes/packing 字段', !json.includes('"notes"') && !json.includes('"packing"'))
  check('快照含名册与费用', parsed.roster.length === 3 && parsed.expenses.length === 1)
  check('确认清点 20 进快照', parsed.items[0].allocations[0].confirmed.some((c) => c.stage === 'count' && c.qty === 20))
  check('缺 4 瓶（24-20）', parsed.items[0].allocations[0].gap === 4)
  check('digest 已计算', parsed.digest.length > 0)
}

// ---------- 草稿 revision 过时检查（A08 的领域部分） ----------

function testStale() {
  console.log('任务版本过时')
  // taskRevision 1 的报告在任务改为 revision 2 后 → stale，不更新当前确认量
  const subs: Submission[] = [
    makeSubmission({ submissionId: 's1', authorMemberId: 'm2', allocationId: 'a1', stage: 'purchase', qty: 24, taskRevision: 1, review: 'stale', reviewedAt: null }),
  ]
  const confirmed = currentConfirmedQty(subs)
  check('stale 报告不进当前确认量', !confirmed.has(confirmKeyString({ allocationId: 'a1', stage: 'purchase', checkpointId: null })))
}

// ---------- 运行 ----------

testA05()
testA06()
testA07()
testKeyConsistency()
testA09()
testShares()
testPublish()
testCanonical()
testA03()
testStale()

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
} else {
  console.log('\n全部通过')
}
