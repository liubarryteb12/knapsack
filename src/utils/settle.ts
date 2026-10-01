import type { Expense, Member, Trip } from '../schema/trip'

export interface Debt {
  fromId: string
  toId: string
  amountFen: number
}

export interface MemberBalance {
  memberId: string
  /** 应收 - 应付（正=应收钱，负=应付钱） */
  netFen: number
}

export interface SettlementResult {
  balances: MemberBalance[]
  debts: Debt[]
  totalExpenseFen: number
}

/**
 * 结算引擎：由每笔花费的分摊算出每人应付份额，付款人建立债权，
 * 净额贪心匹配：欠款最多的每次还给债权最多的。
 * 纯函数，不落盘，每次现算。
 */
export function settleExpenses(trip: Pick<Trip, 'members' | 'expenses'>): SettlementResult {
  const members = trip.members
  const net = new Map<string, number>()
  for (const m of members) net.set(m.id, 0)

  let totalExpenseFen = 0

  for (const expense of trip.expenses) {
    totalExpenseFen += expense.amountFen
    const sharesFen = splitExpenseFen(expense)
    // 付款人垫付：net += 全额
    net.set(expense.payerId, (net.get(expense.payerId) ?? 0) + expense.amountFen)
    // 每个承担人应付自己的份额：net -= 份额
    for (const [memberId, fen] of sharesFen) {
      net.set(memberId, (net.get(memberId) ?? 0) - fen)
    }
  }

  const balances: MemberBalance[] = members.map((m) => ({
    memberId: m.id,
    netFen: net.get(m.id) ?? 0,
  }))

  const debts = greedyMatch(balances)
  return { balances, debts, totalExpenseFen }
}

/** 计算一笔花费中每个人的承担金额（整数分），余数分给列表前部成员 */
export function splitExpenseFen(expense: Expense): Map<string, number> {
  const result = new Map<string, number>()

  if (expense.split.mode === 'equal') {
    const ids = expense.split.memberIds
    const n = ids.length
    if (n === 0) return result
    const base = Math.floor(expense.amountFen / n)
    let remainder = expense.amountFen - base * n
    for (const id of ids) {
      let share = base
      if (remainder > 0) {
        share += 1
        remainder -= 1
      }
      result.set(id, (result.get(id) ?? 0) + share)
    }
    return result
  }

  if (expense.split.mode === 'shares') {
    const { memberIds, shares } = expense.split
    const totalShares = shares.reduce((a, b) => a + b, 0)
    if (totalShares <= 0) return result
    for (let i = 0; i < memberIds.length; i++) {
      const id = memberIds[i]
      const shareCount = shares[i]
      if (id === undefined || shareCount === undefined) continue
      const amount = Math.floor((expense.amountFen * shareCount) / totalShares)
      result.set(id, (result.get(id) ?? 0) + amount)
    }
    // 整除误差分给第一个成员
    const allocated = [...result.values()].reduce((a, b) => a + b, 0)
    const remainderFen = expense.amountFen - allocated
    if (remainderFen !== 0) {
      const firstId = memberIds[0]
      if (firstId !== undefined) {
        result.set(firstId, (result.get(firstId) ?? 0) + remainderFen)
      }
    }
    return result
  }

  // custom
  for (const [id, amount] of Object.entries(expense.split.amounts)) {
    if (amount > 0) result.set(id, (result.get(id) ?? 0) + amount)
  }
  return result
}

/** 净额贪心：欠款最多的还给债权最多的，直到归零 */
function greedyMatch(balances: MemberBalance[]): Debt[] {
  const debtors = balances
    .filter((b) => b.netFen < 0)
    .map((b) => ({ id: b.memberId, amount: -b.netFen }))
    .sort((a, b) => b.amount - a.amount)
  const creditors = balances
    .filter((b) => b.netFen > 0)
    .map((b) => ({ id: b.memberId, amount: b.netFen }))
    .sort((a, b) => b.amount - a.amount)

  const debts: Debt[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!
    const creditor = creditors[j]!
    const amount = Math.min(debtor.amount, creditor.amount)
    if (amount > 0) {
      debts.push({ fromId: debtor.id, toId: creditor.id, amountFen: amount })
      debtor.amount -= amount
      creditor.amount -= amount
    }
    if (debtor.amount === 0) i++
    if (creditor.amount === 0) j++
  }
  return debts
}

/** 成员名查找 */
export function memberName(members: Member[], id: string): string {
  return members.find((m) => m.id === id)?.name ?? '未知成员'
}
