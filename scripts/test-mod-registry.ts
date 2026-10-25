/**
 * ModRegistry 本地开关持久化测试。
 *
 * 运行：npx tsx scripts/test-mod-registry.ts
 */
const memory = new Map<string, string>()
const storage = {
  get length() {
    return memory.size
  },
  clear: () => memory.clear(),
  getItem: (key: string) => memory.get(key) ?? null,
  key: (index: number) => [...memory.keys()][index] ?? null,
  removeItem: (key: string) => memory.delete(key),
  setItem: (key: string, value: string) => memory.set(key, value),
} as Storage

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
})

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function main() {
  const { MOD_MANIFESTS, enabledMods, modState, setModEnabled } = await import(
    '../src/core/modRegistry'
  )

  check('默认登记旅行、日常、账房模块', MOD_MANIFESTS.length === 3)
  check('默认三个模块都启用', modState.trip && modState.daily && modState.finance)
  check(
    '三端导航路由已登记',
    MOD_MANIFESTS.map((m) => m.route).join(',') === '/,/daily,/finance',
  )

  setModEnabled('daily', false)
  const raw = storage.getItem('knapsack.mod-state.v1')
  const persisted = raw ? (JSON.parse(raw) as Record<string, boolean>) : null
  check('关闭日常后写入本机存储', persisted?.daily === false)
  check('关闭后 enabledMods 不含日常', !enabledMods().some((m) => m.id === 'daily'))

  setModEnabled('daily', true)
  check('重新开启后恢复导航模块', enabledMods().some((m) => m.id === 'daily'))

  setModEnabled('finance', false)
  check('账房模块可关闭', !enabledMods().some((m) => m.id === 'finance'))
  setModEnabled('finance', true)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
