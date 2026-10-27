import { readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const scriptsDir = path.join(root, 'scripts')
const files = readdirSync(scriptsDir)
  .filter((name) => /^test-.*\.ts$/.test(name))
  .sort((a, b) => a.localeCompare(b))

let failed = 0
for (const file of files) {
  const script = path.join(scriptsDir, file)
  console.log(`\n[test] ${file}`)
  const result = spawnSync(
    process.execPath,
    ['--import', './scripts/lib/tsx-preload.mjs', '--import', 'tsx', script],
    {
      cwd: root,
      env: { ...process.env, TMPDIR: path.join(root, '.tmp') },
      stdio: 'inherit',
    },
  )
  if (result.status !== 0) {
    failed++
    console.error(`[fail] ${file}, exit=${String(result.status ?? result.signal)}`)
  }
}

console.log(`\ntest_files=${files.length}`)
console.log(`test_failures=${failed}`)
if (failed > 0) process.exit(1)
