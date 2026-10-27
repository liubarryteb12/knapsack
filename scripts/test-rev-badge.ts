// 细节 B 验证：修订强提示的数据逻辑（角标触发 + diff 计算）
import { submissionSchema, teamStateSchema, type Submission } from '../src/mods/mod-team/domain/schema'

let failed = 0
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

function mk(p: Partial<Submission> & { submissionId: string; revision: number }): Submission {
  return submissionSchema.parse({
    teamId: 't1', authorMemberId: 'm2', allocationId: 'a1', stage: 'purchase',
    checkpointId: null, taskRevision: 1, qty: null, amountFen: null,
    expenseReportId: null, payerMemberId: null, relatedAllocationIds: [], note: '',
    uploadedAt: null, review: 'submitted', reviewNote: '', reviewedAt: null, ...p,
  })
}

// 复刻 TeamSummaryTab 的 pending / diffText 纯逻辑
function buildPending(subs: Submission[]) {
  return subs
    .filter(
      (s) =>
        s.review === 'submitted' &&
        !subs.some(
          (o) =>
            o.submissionId === s.submissionId &&
            o.revision > s.revision &&
            (o.review === 'submitted' || o.review === 'confirmed'),
        ),
    )
    .map((s) => {
      const older = subs.filter((o) => o.submissionId === s.submissionId && o.revision < s.revision)
        .sort((a, b) => b.revision - a.revision)
      return { sub: s, prev: older[0] ?? null }
    })
}
function diffText(a: Submission, b: Submission): string[] {
  const out: string[] = []
  if (a.qty !== b.qty) out.push(`数量 ${a.qty ?? '—'} → ${b.qty ?? '—'}`)
  if (a.amountFen !== b.amountFen) {
    const f = (v: number | null) => (v === null ? '—' : (v / 100).toFixed(2))
    out.push(`金额 ${f(a.amountFen)} → ${f(b.amountFen)} 元`)
  }
  if (a.note !== b.note) out.push(`备注「${a.note || '（空）'}」→「${b.note || '（空）'}」`)
  return out
}

console.log('细节 B：修订强提示')

// 1. 首次提交（无旧版）→ 无角标
const p1 = buildPending([mk({ submissionId: 'S1', revision: 1, qty: 24 })])
check('首版报告无「已修订」角标', p1.length === 1 && p1[0]!.prev === null)

// 2. 修订一次 → 有角标 + prev 指向旧版
const p2 = buildPending([
  mk({ submissionId: 'S2', revision: 1, qty: 20 }),
  mk({ submissionId: 'S2', revision: 2, qty: 24 }),
])
check('修订后角标触发（prev 非空）', p2.length === 1 && p2[0]!.prev !== null)
check('prev 指向最近的旧版（revision 1）', p2[0]!.prev!.revision === 1)
check('旧版不重复占位（pending 只有 1 条）', p2.length === 1)

// 3. diff 内容：数量变化
const d1 = diffText(p2[0]!.prev!, p2[0]!.sub)
check('diff 报出数量变化', d1.length === 1 && d1[0] === '数量 20 → 24')

// 4. diff：金额 + 备注同时变
const p3 = buildPending([
  mk({ submissionId: 'S3', revision: 1, qty: 20, amountFen: 3600, note: '旧备注' }),
  mk({ submissionId: 'S3', revision: 2, qty: 20, amountFen: 4000, note: '新备注' }),
])
const d2 = diffText(p3[0]!.prev!, p3[0]!.sub)
check('diff 报出金额变化', d2.some((x) => x.includes('金额 36.00 → 40.00')))
check('diff 报出备注变化', d2.some((x) => x.includes('旧备注') && x.includes('新备注')))

// 5. 三次修订 → prev 是倒数第二版（revision 2），不是 revision 1
const p4 = buildPending([
  mk({ submissionId: 'S4', revision: 1, qty: 10 }),
  mk({ submissionId: 'S4', revision: 2, qty: 15 }),
  mk({ submissionId: 'S4', revision: 3, qty: 20 }),
])
check('多次修订取最近旧版（revision 2）', p4[0]!.prev!.revision === 2)

// 6. 旧版已确认（confirmed）时，待审的新版仍有角标
const p5 = buildPending([
  mk({ submissionId: 'S5', revision: 1, qty: 20, review: 'confirmed' }),
  mk({ submissionId: 'S5', revision: 2, qty: 24, review: 'submitted' }),
])
check('旧版已确认仍显示修订角标', p5.length === 1 && p5[0]!.prev !== null)

// 7. 空 diff（内容相同）→ 不显示任何差异行
const p6 = buildPending([
  mk({ submissionId: 'S6', revision: 1, qty: 20, note: '同' }),
  mk({ submissionId: 'S6', revision: 2, qty: 20, note: '同' }),
])
check('内容相同的修订 diff 为空', diffText(p6[0]!.prev!, p6[0]!.sub).length === 0)

console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
if (failed > 0) process.exit(1)
