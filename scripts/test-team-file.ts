/**
 * 团队文件兜底测试（P6）——按 PLAN 验收矩阵 A31/A32/A33 编号对应
 *
 * 运行：npx tsx scripts/test-team-file.ts
 * 只测纯函数：序列化/解析/校验/去重；文件读写搬运（fileBridge）需真机验证（A34）。
 */
import {
  serializePublicFile,
  parsePublicFile,
  serializeSubmissionFile,
  parseSubmissionFile,
  checkPublicImport,
  dedupeSubmissions,
  publicFileName,
  submissionFileName,
} from '../src/team/teamFile'
import { buildPublicSnapshot, digestOf } from '../src/team/domain'
import { submissionSchema, teamStateSchema, type Submission, type TeamState } from '../src/team/schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function throws(name: string, fn: () => unknown) {
  try {
    fn()
    check(name, false)
  } catch {
    check(name, true)
  }
}

function makeSubmission(
  p: Partial<Submission> & { submissionId: string; authorMemberId: string },
): Submission {
  return submissionSchema.parse({
    revision: 1,
    teamId: 't1',
    stage: 'purchase',
    allocationId: 'a1',
    checkpointId: null,
    taskRevision: 1,
    qty: null,
    amountFen: null,
    expenseReportId: null,
    payerMemberId: null,
    relatedAllocationIds: [],
    note: '',
    uploadedAt: 1000,
    review: 'submitted',
    reviewNote: '',
    reviewedAt: null,
    ...p,
  })
}

function makeTeam(): TeamState {
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
    ],
    items: [{ itemId: 'item1', name: '水', category: 'food', qtyNeeded: 24, unit: '瓶', note: '' }],
    allocations: [
      { allocationId: 'a1', itemId: 'item1', qtyPlanned: 24, purchaseBy: 'm2', carryBy: null, note: '' },
    ],
    checkpoints: [],
    submissions: [],
    expenses: [],
    latestPublication: null,
    publicationHistory: [],
    credentialSecret: 'SECRET-DO-NOT-SHARE',
    pendingJoins: [
      {
        joinRequestId: 'j1',
        deviceId: 'dev1',
        memberName: '乙',
        clientPub: 'PUB',
        status: 'approved',
        memberId: 'm2',
        credential: 'CRED-DO-NOT-SHARE',
        createdAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  })
}

// ---------- A31 公共文件：白名单、无私人秘密、版本核对 ----------

console.log('A31 公共资料文件')
const team = makeTeam()
const snap = buildPublicSnapshot(team, 'pub1', 2, 5000)
const pubText = serializePublicFile(snap)

check('round-trip 解析结果一致', JSON.stringify(parsePublicFile(pubText)) === JSON.stringify(snap))
check('不含 credentialSecret', !pubText.includes('credentialSecret') && !pubText.includes('SECRET-DO-NOT-SHARE'))
check('不含成员凭证', !pubText.includes('CRED-DO-NOT-SHARE'))
check('不含 pendingJoins', !pubText.includes('pendingJoins'))
check(
  '顶层只含白名单字段',
  (() => {
    const keys = Object.keys(JSON.parse(pubText) as Record<string, unknown>).sort()
    const expect = [
      'assignments',
      'checkpoints',
      'createdAt',
      'digest',
      'expenses',
      'format',
      'items',
      'itinerary',
      'publicationId',
      'roster',
      'sourceDraftRevision',
      'teamId',
      'version',
    ].sort()
    return JSON.stringify(keys) === JSON.stringify(expect)
  })(),
)

const imp0 = checkPublicImport(pubText, 0)
check('无本地版本 → unknown', imp0.comparison === 'unknown')
check('digest 自洽', imp0.digestOk === true)
check('本地 1 版 → newer', checkPublicImport(pubText, 1).comparison === 'newer')
check('本地 2 版 → same', checkPublicImport(pubText, 2).comparison === 'same')
check('本地 3 版 → older', checkPublicImport(pubText, 3).comparison === 'older')

const tampered = JSON.stringify({ ...JSON.parse(pubText), version: 9 })
check('篡改后 digest 不自洽', checkPublicImport(tampered, 1).digestOk === false)

// ---------- A32 报告文件：去重 / 冲突 / 人工来源 ----------

console.log('A32 报告文件')
const s1 = makeSubmission({ submissionId: 's1', authorMemberId: 'm2', qty: 24, note: '买24' })
const s1dup = makeSubmission({ submissionId: 's1', authorMemberId: 'm2', qty: 24, note: '买24' })
const s1diff = makeSubmission({ submissionId: 's1', authorMemberId: 'm2', qty: 20, note: '买20' })
const s1rev2 = makeSubmission({ submissionId: 's1', authorMemberId: 'm2', revision: 2, qty: 24, note: '买24' })
const s2 = makeSubmission({ submissionId: 's2', authorMemberId: 'm2', qty: 1 })

const dedup = dedupeSubmissions([s1dup, s1diff, s1rev2, s2], [s1])
check('同 ID 同版本同内容 → duplicate', dedup.duplicates.length === 1 && dedup.duplicates[0]!.submissionId === 's1')
check('同 ID 同版本异内容 → conflict（不静默覆盖）', dedup.conflicts.length === 1 && dedup.conflicts[0]!.qty === 20)
check('同 ID 高版本 → fresh', dedup.fresh.some((s) => s.submissionId === 's1' && s.revision === 2))
check('新 ID → fresh', dedup.fresh.some((s) => s.submissionId === 's2'))
check('三分类总数守恒', dedup.fresh.length + dedup.duplicates.length + dedup.conflicts.length === 4)

const subText = serializeSubmissionFile('t1', [s1, s2], '乙（自报）')
const parsedSub = parseSubmissionFile(subText)
check('报告文件 round-trip', parsedSub.submissions.length === 2)
check('导出方仅作自报展示', parsedSub.exportedBy === '乙（自报）')
check('报告文件含团队标识', parsedSub.teamId === 't1')
check(
  '同 ID 异内容不被视为同一报告',
  digestOf(s1) !== digestOf(s1diff),
)

// ---------- A33 兼容：未知格式拒绝，不静默丢字段 ----------

console.log('A33 格式兼容')
throws('非 JSON 公共文件拒绝', () => parsePublicFile('not json {'))
throws('未知 format 公共文件拒绝', () => parsePublicFile(JSON.stringify({ format: 'trip.v1', name: 'x' })))
throws('缺 format 公共文件拒绝', () => parsePublicFile(JSON.stringify({ teamId: 't1' })))
throws('非 JSON 报告文件拒绝', () => parseSubmissionFile('nope'))
throws('未知 format 报告文件拒绝', () => parseSubmissionFile(JSON.stringify({ format: 'team.v1' })))
throws('旧 trip.v1 不会被当团队文件导入', () =>
  parsePublicFile(JSON.stringify({ format: 'trip.v1', trips: [] })),
)

check('公共文件名带扩展名与版本', publicFileName('国庆/露营', 3).endsWith('.team-public'))
check('公共文件名清理非法字符', !publicFileName('国庆/露营', 3).includes('/'))
check('报告文件名带扩展名', submissionFileName('测试团', '乙').endsWith('.team-submit'))

console.log('')
if (failed > 0) {
  console.error(`失败 ${failed} 项`)
  process.exit(1)
} else {
  console.log('P6 文件兜底：全部通过')
}
