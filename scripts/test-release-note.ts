// 细节 A 验证：发布说明的序列化/校验/边界
import { publicSnapshotSchema } from '../src/mods/mod-team/domain/schema'
import { buildPublicSnapshot, digestOf } from '../src/mods/mod-team/domain/domain'
import { teamStateSchema } from '../src/mods/mod-team/domain/schema'

let failed = 0
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const team = teamStateSchema.parse({
  format: 'team.v1', teamId: 't1', name: '团', myMemberId: 'org1',
  draftRevision: 1, revision: 1,
  roster: [{ memberId: 'org1', name: '甲', role: 'organizer', joinedAt: 1 }],
  items: [], allocations: [], checkpoints: [], submissions: [], expenses: [],
  latestPublication: null, publicationHistory: [], credentialSecret: null,
  pendingJoins: [], createdAt: 1, updatedAt: 1,
})

console.log('细节 A：发布说明')

// 1. 空值默认 ''
const s1 = buildPublicSnapshot(team, 'p1', 1, 1000)
check('缺省 releaseNote 为空串', s1.releaseNote === '')
check('空串时成员端 alert 不渲染（v-if 判空）', !s1.releaseNote)

// 2. 普通文本
const s2 = buildPublicSnapshot(team, 'p2', 1, 1000, '请大家周五前到齐')
check('普通文本透传', s2.releaseNote === '请大家周五前到齐')

// 3. Emoji + 多行
const s3 = buildPublicSnapshot(team, 'p3', 1, 1000, '出发啦 🎒\n第二行：别忘了带伞 ☔\n🎉🎉')
check('Emoji 与多行透传', s3.releaseNote.includes('🎒') && s3.releaseNote.includes('\n'))
const j3 = JSON.stringify(publicSnapshotSchema.parse(s3))
check('序列化/反序列化后一致', (JSON.parse(j3) as { releaseNote: string }).releaseNote === s3.releaseNote)

// 4. 500 字边界可生成、可校验；501 字才拒绝
const long = '长'.repeat(500)
const s4 = buildPublicSnapshot(team, 'p4', 1, 1000, long)
check('超长文本不崩溃（build 层透传）', s4.releaseNote.length === 500)
const r4 = publicSnapshotSchema.safeParse(s4)
check('schema 接受 500 字边界', r4.success)
const tooLong = buildPublicSnapshot(team, 'p5-long', 1, 1000, '长'.repeat(501))
check('schema 拒绝 501 字', !publicSnapshotSchema.safeParse(tooLong).success)

// 5. digest 随 releaseNote 变化（不同说明 = 不同快照）
const s5 = buildPublicSnapshot(team, 'p5', 1, 1000, '另一句寄语')
check('releaseNote 参与 digest（不同说明快照不同）', s5.digest !== s2.digest)

// 6. 同内容 digest 稳定
const s6 = buildPublicSnapshot(team, 'p2', 1, 1000, '请大家周五前到齐')
check('同内容 digest 稳定（可幂等比对）', s6.digest === s2.digest)

console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
if (failed > 0) process.exit(1)
