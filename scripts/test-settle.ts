/**
 * 阶段4 验收测试脚本：验证金额无浮点误差、结算结果正确。
 * 运行：npx tsx scripts/test-settle.ts
 * （Node 侧直接跑纯函数，不涉及 IndexedDB）
 */
import {
  settleExpenses,
  splitExpenseFen,
} from '../src/utils/settle'
import type { Expense, Trip } from '../src/schema/trip'

let failed = 0
function expectEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`✓ ${label}`)
  } else {
    console.error(`✗ ${label}\n  期望: ${e}\n  实际: ${a}`)
    failed++
  }
}

const members = [
  { id: 'm1', name: '我', role: 'owner' as const },
  { id: 'm2', name: '小李', role: 'member' as const },
  { id: 'm3', name: '小王', role: 'member' as const },
]

// ---- 测试1：equal 均分，除不尽的余数分配 ----
const e1: Expense = {
  id: 'e1',
  date: '2026-05-01',
  category: 'food',
  title: '晚餐',
  amountFen: 10001, // 100.01 元 / 3 人
  payerId: 'm1',
  split: { mode: 'equal', memberIds: ['m1', 'm2', 'm3'] },
}
const split1 = splitExpenseFen(e1)
const sum1 = [...split1.values()].reduce((a, b) => a + b, 0)
expectEq(sum1, 10001, '均分总和 = 原金额（无浮点误差）')
expectEq(split1.get('m1'), 3334, '均分余数分给第一个成员')
expectEq(split1.get('m2'), 3334, '均分余数分给第二个成员')
expectEq(split1.get('m3'), 3333, '均分第三人')

// ---- 测试2：shares 按份 ----
const e2: Expense = {
  id: 'e2',
  date: '2026-05-01',
  category: 'transport',
  title: '打车',
  amountFen: 9000,
  payerId: 'm2',
  split: { mode: 'shares', memberIds: ['m1', 'm2', 'm3'], shares: [1, 1, 2] },
}
const split2 = splitExpenseFen(e2)
expectEq(split2.get('m1'), 2250, '按份 1/4')
expectEq(split2.get('m2'), 2250, '按份 1/4')
expectEq(split2.get('m3'), 4500, '按份 2/4')

// ---- 测试3：custom 自定义 ----
const e3: Expense = {
  id: 'e3',
  date: '2026-05-02',
  category: 'stay',
  title: '酒店',
  amountFen: 50000,
  payerId: 'm1',
  split: { mode: 'custom', amounts: { m1: 25000, m2: 25000, m3: 0 } },
}
const split3 = splitExpenseFen(e3)
expectEq(split3.get('m1'), 25000, '自定义 m1')
expectEq(split3.get('m2'), 25000, '自定义 m2')
expectEq(split3.has('m3'), false, '自定义 0 元不入分担')

// ---- 测试4：完整结算，净额贪心 ----
// 完整结算：
// e1: m1 付 10001，承担 3334/3334/3333 → m1: +6667, m2: -3334, m3: -3333
// e2: m2 付 9000，承担 2250/2250/4500 → m1: +4417, m2: +3416, m3: -7833
// e3: m1 付 50000，m1/m2 各承担 25000 → m1: +29417, m2: -21584, m3: -7833
const result = settleExpenses({ members, expenses: [e1, e2, e3] } as Pick<Trip, 'members' | 'expenses'>)
const balanceMap = Object.fromEntries(result.balances.map((b) => [b.memberId, b.netFen]))
expectEq(balanceMap['m1'], 29417, 'm1 净应收 294.17 元')
expectEq(balanceMap['m2'], -21584, 'm2 净应付 215.84 元')
expectEq(balanceMap['m3'], -7833, 'm3 净应付 78.33 元')
expectEq(
  result.balances.reduce((a, b) => a + b.netFen, 0),
  0,
  '净额总和为 0（守恒）',
)

// 债务：m2 欠最多(21584) → 先还 m1；m3 欠 7833 → 还 m1 剩余 29417-21584=7833
expectEq(result.debts.length, 2, '两笔债务')
expectEq(result.debts[0]?.fromId, 'm2', '欠最多的 m2 先还款')
expectEq(result.debts[0]?.toId, 'm1', 'm2 还给 m1')
expectEq(result.debts[0]?.amountFen, 21584, 'm2 还 215.84')
expectEq(result.debts[1]?.fromId, 'm3', 'm3 还款')
expectEq(result.debts[1]?.amountFen, 7833, 'm3 还 78.33')
const debtTotal = result.debts.reduce((a, d) => a + d.amountFen, 0)
expectEq(debtTotal, 29417, '债务总额 = 最大债权')

// ---- 测试5：无成员/空花费 ----
const empty = settleExpenses({ members: [], expenses: [] })
expectEq(empty.balances.length, 0, '无成员无债务')
expectEq(empty.debts.length, 0, '空花费无债务')

console.log(failed === 0 ? '\n全部通过 ✔' : `\n${failed} 个用例失败 ✘`)
if (failed > 0) process.exit(1)
