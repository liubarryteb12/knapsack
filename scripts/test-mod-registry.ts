/**
 * ModRegistry 本地开关与当前卡带适配测试。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-mod-registry.ts
 */
import { createModRegistry } from '../src/core/modRegistry'
import { STATIC_MOD_MANIFESTS } from '../src/mods/manifest-index'

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

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function main() {
  const registry = createModRegistry(STATIC_MOD_MANIFESTS, storage)

  check('自动包含旅行、日常、账房与团队卡带', ['mod-trip', 'mod-daily', 'mod-finance', 'mod-team'].every((id) => registry.getManifest(id)))
  check('默认模块进入自动导航', registry.enabledNavItems.some((item) => item.to === '/daily'))
  check('团队卡带包含独立工作台入口', registry.enabledNavItems.some((item) => item.to === '/team-hub'))
  check(
    '团队导航声明群组子路由激活范围',
    registry.enabledNavItems.find((item) => item.to === '/team-hub')?.activePaths?.includes('/team') === true,
  )
  check('团队旧路由保留兼容', registry.getManifest('mod-team')?.routes.some((route) => route.path === '/teams') === true)
  check('旅行卡带不再包含团队路由', !registry.getManifest('mod-trip')?.routes.some((route) => route.path === '/teams'))

  await registry.setEnabled('mod-daily', false)
  const raw = storage.getItem('knapsack.mod-state.v1')
  const persisted = raw ? (JSON.parse(raw) as Record<string, boolean>) : null
  check('关闭日常后写入开放 id', persisted?.['mod-daily'] === false)
  check('关闭后 enabledMods 不含日常', !registry.enabledManifests.some((m) => m.id === 'mod-daily'))

  await registry.setEnabled('mod-daily', true)
  check('重新开启后恢复导航模块', registry.enabledManifests.some((m) => m.id === 'mod-daily'))

  await registry.setEnabled('mod-finance', false)
  check('账房模块可关闭', !registry.enabledManifests.some((m) => m.id === 'mod-finance'))
  await registry.setEnabled('mod-finance', true)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
