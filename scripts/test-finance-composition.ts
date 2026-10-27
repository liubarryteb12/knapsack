/**
 * 账务结构占比最大余额法契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-finance-composition.ts
 */
import { computeComposition } from '../src/engines/ledger-engine/composition-analyzer'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function permilleSum(items: Array<{ key: string; amountCents: number }>) {
  return computeComposition(items).reduce((sum, item) => sum + item.permille, 0)
}

function main() {
  const thirds = computeComposition([
    { key: 'food', amountCents: 1 },
    { key: 'transport', amountCents: 1 },
    { key: 'stay', amountCents: 1 },
  ])
  check('三等分占比精确合计 100.0%', permilleSum([
    { key: 'food', amountCents: 1 },
    { key: 'transport', amountCents: 1 },
    { key: 'stay', amountCents: 1 },
  ]) === 1000)
  check('最大余额法把尾差分给稳定排序项', thirds.map((item) => item.permille).join(',') === '334,333,333')
  check('占比同时提供一位小数字符串', thirds[0]?.percentText === '33.4%')

  const mixed = computeComposition([
    { key: 'a', amountCents: 1000 },
    { key: 'b', amountCents: 2000 },
    { key: 'c', amountCents: 3000 },
    { key: 'd', amountCents: 4000 },
  ])
  check('普通比例合计仍为 100.0%', mixed.reduce((sum, item) => sum + item.permille, 0) === 1000)
  check('普通比例计算准确', mixed.map((item) => item.percentText).join(',') === '10.0%,20.0%,30.0%,40.0%')

  check('零账本返回空结构而非 NaN', computeComposition([]).length === 0)
  check('全零条目返回空结构', computeComposition([
    { key: 'food', amountCents: 0 },
    { key: 'stay', amountCents: 0 },
  ]).length === 0)

  const huge = computeComposition([
    { key: 'a', amountCents: 9_000_000_000_000 },
    { key: 'b', amountCents: 1_000_000_000_000 },
  ])
  check('超大整数分保持精确 90/10', huge.map((item) => item.percentText).join(',') === '90.0%,10.0%')

  let rejected = false
  try {
    computeComposition([{ key: 'bad', amountCents: -1 }])
  } catch {
    rejected = true
  }
  check('负金额被拒绝', rejected)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main()
