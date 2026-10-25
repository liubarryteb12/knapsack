/**
 * AIMS 细节 A 回归：发布预览必须可复现，发布说明参与预览与幂等摘要。
 *
 * 运行：npx tsx scripts/test-publish-preview.ts
 */
import 'fake-indexeddb/auto'
import { createTeam, getTeam, latestPublicationOf, publishSnapshot } from '../src/db/teamActions'
import { buildPublicSnapshot } from '../src/team/domain'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function main() {
  console.log('发布预览与幂等')

  const team = await createTeam({ name: '预览测试团', organizerName: '甲' })
  const organizerId = team.roster[0]!.memberId
  const note = '集合点改到东门 🎒\n请提前十分钟到'

  const preview1 = buildPublicSnapshot(team, 'preview', 0, 0, note)
  const preview2 = buildPublicSnapshot(team, 'preview', 0, 0, note)
  check('相同输入预览摘要稳定', preview1.digest === preview2.digest)
  check('发布说明参与预览摘要', preview1.digest !== buildPublicSnapshot(team, 'preview', 0, 0).digest)

  const first = await publishSnapshot({
    teamId: team.teamId,
    organizerMemberId: organizerId,
    operationId: 'publish-preview-op-1',
    expectedDraftRevision: team.draftRevision,
    expectedPreviewDigest: preview1.digest,
    releaseNote: note,
  })
  check('预览摘要匹配时发布成功', first.ok && first.version === 1)

  const latest = await latestPublicationOf(team.teamId)
  check('快照保存发布说明', latest?.releaseNote === note)

  const replay = await publishSnapshot({
    teamId: team.teamId,
    organizerMemberId: organizerId,
    operationId: 'publish-preview-op-1',
    expectedDraftRevision: team.draftRevision,
    expectedPreviewDigest: preview1.digest,
    releaseNote: note,
  })
  check('同 operationId 同内容幂等重放', replay.ok && replay.version === 1 && replay.created === false)

  const conflict = await publishSnapshot({
    teamId: team.teamId,
    organizerMemberId: organizerId,
    operationId: 'publish-preview-op-1',
    expectedDraftRevision: team.draftRevision,
    expectedPreviewDigest: preview1.digest,
    releaseNote: '换了寄语',
  })
  check('同 operationId 更换发布说明必须冲突', !conflict.ok)

  const fresh = await getTeam(team.teamId)
  check('冲突请求没有新增版本', fresh?.latestPublication?.version === 1)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
