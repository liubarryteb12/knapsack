/**
 * 阶段1/阶段13 验收：.trip 导入校验 + id 重建映射测试。
 * 运行：npx tsx scripts/test-tripfile.ts
 */
import { readTripFile, TripImportError } from '../src/utils/tripFile'
import { regenerateAllIds } from '../src/utils/regenerateIds'
import type { Trip } from '../src/schema/trip'

let failed = 0
function expect(cond: boolean, label: string) {
  if (cond) console.log(`OK  ${label}`)
  else {
    console.error(`FAIL ${label}`)
    failed++
  }
}

function expectImportError(text: string, kind: TripImportError['kind'], label: string) {
  try {
    readTripFile(text)
    expect(false, `${label}（竟然没抛错）`)
  } catch (err) {
    const isRight = err instanceof TripImportError && err.kind === kind
    expect(isRight, `${label} → ${err instanceof TripImportError ? err.message : String(err)}`)
  }
}

const goodTrip = {
  format: 'trip.v1',
  id: 'abc123',
  name: '测试旅行',
  startDate: '2026-05-01',
  endDate: '2026-05-02',
  destType: 'city',
  destCity: '杭州',
  totalBudgetFen: 100000,
  members: [{ id: 'm1', name: '我', role: 'owner' }],
  days: [
    { date: '2026-05-01', items: [{ id: 'i1', time: '09:00', type: 'play', title: '西湖', note: '', linkedExpenseId: null, done: false }] },
    { date: '2026-05-02', items: [] },
  ],
  expenses: [{ id: 'e1', date: '2026-05-01', category: 'food', title: '午饭', amountFen: 5000, payerId: 'm1', split: { mode: 'equal', memberIds: ['m1'] } }],
  packing: [{ group: '证件', items: [{ id: 'k1', label: '身份证', packed: false }] }],
  notes: '',
  enabledModules: { expenses: true, notes: true },
}

// 好文件能过
const parsed = readTripFile(JSON.stringify(goodTrip))
expect(parsed.name === '测试旅行', '合法 .trip 正常导入')

// 坏文件 1：不是 JSON
expectImportError('这不是JSON{{{', 'not_json', '非 JSON 文本')

// 坏文件 2：JSON 但不是对象
expectImportError('[1,2,3]', 'bad_format', '数组根')

// 坏文件 3：format 不对
expectImportError(JSON.stringify({ ...goodTrip, format: 'trip.v2' }), 'bad_format', 'format 版本不符')

// 坏文件 4：format 缺失
const { format: _f, ...noFormat } = goodTrip
expectImportError(JSON.stringify(noFormat), 'bad_format', 'format 缺失')

// 坏文件 5：字段非法（负金额）
expectImportError(
  JSON.stringify({ ...goodTrip, expenses: [{ ...goodTrip.expenses[0], amountFen: -100 }] }),
  'invalid_data',
  '负金额被拒',
)

// 坏文件 6：日期格式错
expectImportError(JSON.stringify({ ...goodTrip, startDate: '2026/05/01' }), 'invalid_data', '日期格式错')

// 坏文件 7：必填字段缺失
expectImportError(JSON.stringify({ ...goodTrip, name: '' }), 'invalid_data', '空名称被拒')

// ---- regenerateAllIds 引用一致性 ----
const copy: Trip = JSON.parse(JSON.stringify(goodTrip))
regenerateAllIds(copy)

expect(copy.id !== goodTrip.id, '副本旅行 id 已变')
expect(copy.members[0]!.id !== goodTrip.members[0]!.id, '成员 id 已变')
expect(copy.expenses[0]!.id !== goodTrip.expenses[0]!.id, '花费 id 已变')

// payerId 跟随成员映射
const oldMemberId = goodTrip.members[0]!.id
const newMemberId = copy.members[0]!.id
expect(copy.expenses[0]!.payerId === newMemberId, 'payerId 已同步到新成员 id')
expect(copy.expenses[0]!.payerId !== oldMemberId, 'payerId 不再指向旧 id')

// split.memberIds 同步
const oldSplitIds = (goodTrip.expenses[0]!.split as { memberIds: string[] }).memberIds
const newSplitIds = (copy.expenses[0]!.split as { memberIds: string[] }).memberIds
expect(newSplitIds[0] === newMemberId && newSplitIds[0] !== oldSplitIds[0], 'split.memberIds 已同步')

// 条目 linkedExpenseId 同步（原 null → null）
expect(copy.days[0]!.items[0]!.linkedExpenseId === null, 'linkedExpenseId null 保持 null')

// 花费引用映射：构造 linkedExpenseId 指向 e1 的条目
const withLink = JSON.parse(JSON.stringify(goodTrip)) as Trip
withLink.days[0]!.items[0]!.linkedExpenseId = 'e1'
regenerateAllIds(withLink)
const newExpenseId = withLink.expenses[0]!.id
const withLinkMemberId = withLink.members[0]!.id
expect(withLink.days[0]!.items[0]!.linkedExpenseId === newExpenseId, 'linkedExpenseId 映射到新花费 id')

// custom amounts 键同步
const customTrip = JSON.parse(JSON.stringify(goodTrip)) as Trip
customTrip.expenses[0]!.split = { mode: 'custom', amounts: { m1: 5000 } }
regenerateAllIds(customTrip)
const amounts = (customTrip.expenses[0]!.split as { amounts: Record<string, number> }).amounts
const customMemberId = customTrip.members[0]!.id
expect(Object.keys(amounts).length === 1, 'custom amounts 只剩一个键')
expect(amounts[customMemberId] === 5000, 'custom amounts 键已映射且金额保留')

console.log(failed === 0 ? '\nAll passed' : `\n${failed} failed`)
if (failed > 0) process.exit(1)
