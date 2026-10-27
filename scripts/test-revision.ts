/**
 * AIMS 细节 B 回归：成员修订必须保留旧版本，旧确认继续有效，新版本进入待审。
 *
 * 运行：npx tsx scripts/test-revision.ts
 */
import 'fake-indexeddb/auto'
import {
  acceptSubmission,
  createTeam,
  decideSubmission,
  getTeam,
  saveTeam,
} from '../src/mods/mod-team/db/actions'
import { currentConfirmedQty } from '../src/mods/mod-team/domain/domain'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function draft(revision: number, qty: number) {
  return {
    submissionId: 'rev-sub-1',
    revision,
    allocationId: 'a1',
    stage: 'purchase' as const,
    checkpointId: null,
    taskRevision: 1,
    qty,
    amountFen: null,
    expenseReportId: null,
    payerMemberId: null,
    relatedAllocationIds: [],
    note: revision === 1 ? '首次上报' : '修改数量',
  }
}

async function main() {
  console.log('成员修订保留历史')

  const team = await createTeam({ name: '修订测试团', organizerName: '甲' })
  const organizer = team.roster[0]!.memberId
  team.roster.push({ memberId: 'member-1', name: '乙', role: 'member', joinedAt: 2 })
  team.items.push({
    itemId: 'item-1',
    name: '水',
    category: 'food',
    qtyNeeded: 24,
    unit: '瓶',
    note: '',
  })
  team.allocations.push({
    allocationId: 'a1',
    itemId: 'item-1',
    qtyPlanned: 24,
    purchaseBy: 'member-1',
    carryBy: null,
    note: '',
  })
  await saveTeam(team)

  const first = await acceptSubmission({
    teamId: team.teamId,
    authorMemberId: 'member-1',
    operationId: 'rev-op-1',
    draft: draft(1, 20),
  })
  check('首版接收', first.ok)

  const confirmed = await decideSubmission({
    teamId: team.teamId,
    organizerMemberId: organizer,
    operationId: 'rev-confirm-1',
    submissionId: 'rev-sub-1',
    revision: 1,
    decision: 'confirmed',
  })
  check('首版确认', confirmed.ok)

  const second = await acceptSubmission({
    teamId: team.teamId,
    authorMemberId: 'member-1',
    operationId: 'rev-op-2',
    draft: draft(2, 24),
  })
  check('修订接收', second.ok)

  const after = await getTeam(team.teamId)
  const rows = after!.submissions.filter((s) => s.submissionId === 'rev-sub-1')
  check('旧版与新版本都保留', rows.length === 2 && rows.some((s) => s.revision === 1) && rows.some((s) => s.revision === 2))
  check('旧版仍是 confirmed', rows.find((s) => s.revision === 1)?.review === 'confirmed')
  check('新版进入 submitted', rows.find((s) => s.revision === 2)?.review === 'submitted')
  check('当前确认量仍取旧确认值 20', currentConfirmedQty(after!.submissions).get('a1|purchase|')?.qty === 20)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
