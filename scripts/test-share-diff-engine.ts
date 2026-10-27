/**
 * Generic JSON diff engine acceptance tests.
 *
 * Run:
 * node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-share-diff-engine.ts
 */
import { diffJson } from '../src/engines/lan-share-engine/diff-engine'

let failed = 0

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function main(): void {
  check('identical JSON has no diff', diffJson({ id: 1 }, { id: 1 }).length === 0)

  const numericDiff = diffJson(
    { budget: 200, count: 4 },
    { budget: 350, count: 4 },
  )
  check('numeric change has one entry', numericDiff.length === 1)
  check('numeric change identifies amount path', numericDiff[0]?.path.join('.') === 'budget')
  check('numeric change keeps before and after', numericDiff[0]?.before === 200 && numericDiff[0]?.after === 350)
  check('numeric change has numeric kind', numericDiff[0]?.valueKind === 'numeric')

  const textDiff = diffJson(
    { note: '中文原稿', title: '原题' },
    { note: '中文修订稿', title: '原题' },
  )
  check('text change is isolated', textDiff.length === 1)
  check('text change identifies note path', textDiff[0]?.path.join('.') === 'note')
  check('text change has text kind', textDiff[0]?.valueKind === 'text')

  const addRemove = diffJson(
    { items: [{ id: 'a', note: 'keep' }], removed: { value: 1 } },
    { items: [{ id: 'a', note: 'keep' }, { id: 'b', note: 'added' }], added: 'x' },
  )
  check('nested array addition is recognized', addRemove.some((entry) =>
    entry.op === 'add' && entry.path.join('.') === 'items.1' && (entry.after as { id?: string })?.id === 'b',
  ))
  check('object removal is recognized', addRemove.some((entry) =>
    entry.op === 'remove' && entry.path.join('.') === 'removed' &&
    JSON.stringify(entry.before) === JSON.stringify({ value: 1 }),
  ))
  check('object addition is recognized', addRemove.some((entry) =>
    entry.op === 'add' && entry.path.join('.') === 'added' && entry.after === 'x',
  ))

  const complex = diffJson(
    { team: { name: 'Family', members: ['Alice', 'Bob'] }, amount: 10 },
    { team: { name: 'Family', members: ['Alice', 'Bob', 'Carol'] }, amount: 12 },
  )
  check('complex diff has only real changes', complex.length === 2)
  check('complex numeric array tail addition recognized', complex.some((entry) =>
    entry.op === 'add' && entry.path.join('.') === 'team.members.2' && entry.after === 'Carol',
  ))
  check('complex root amount change recognized', complex.some((entry) =>
    entry.op === 'change' && entry.path.join('.') === 'amount' && entry.valueKind === 'numeric',
  ))

  const arrayItemChange = diffJson(
    { items: [{ id: 1, status: 'open' }] },
    { items: [{ id: 1, status: 'done' }] },
  )
  check('array item field change is recognized', arrayItemChange.length === 1 &&
    arrayItemChange[0]?.path.join('.') === 'items.0.status' &&
    arrayItemChange[0]?.after === 'done')

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  if (failed > 0) process.exit(1)
}

main()
