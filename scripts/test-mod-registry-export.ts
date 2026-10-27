/**
 * v4 卡带加载器契约测试。
 *
 * 运行：npx tsx scripts/test-mod-registry-export.ts
 */
import { computed, defineComponent, h } from 'vue'
import {
  createModRegistry,
  validateModManifests,
  type ModManifest,
} from '../src/core/modRegistry'
import { discoverMods } from '../src/core/modDiscovery'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function memoryStorage(): Storage {
  const memory = new Map<string, string>()
  return {
    get length() {
      return memory.size
    },
    clear: () => memory.clear(),
    getItem: (key: string) => memory.get(key) ?? null,
    key: (index: number) => [...memory.keys()][index] ?? null,
    removeItem: (key: string) => {
      memory.delete(key)
    },
    setItem: (key: string, value: string) => {
      memory.set(key, value)
    },
  }
}

const Probe = defineComponent({
  setup: () => () => h('span', 'probe'),
})

function manifest(id: `mod-${string}`, order: number, defaultEnabled = true): ModManifest {
  return {
    id,
    name: id,
    version: '0.0.0',
    schemaRevision: 0,
    description: `${id} fixture`,
    enabledByDefault: defaultEnabled,
    dbStores: [
      {
        name: `mod_${id.slice(4).replaceAll('-', '_')}_items`,
        keyPath: 'id',
        indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }],
        legacyName: `${id}-legacy`,
      },
    ],
    routes: [
      {
        path: `/${id}`,
        name: id,
        component: Probe,
      },
    ],
    navItems: [{ label: id, to: `/${id}`, icon: Probe, order }],
    slotContributions: [
      {
        targetSlot: 'host:quick-action',
        component: Probe,
        order,
      },
    ],
    providesCapabilities: {
      'capability:test': async () => ({ id }),
    },
  }
}

async function main() {
  console.log('manifest contract')
  const alpha = manifest('mod-alpha', 20)
  const beta = manifest('mod-beta', 10, false)
  const manifests = validateModManifests([alpha, beta])
  check('开放 id 合法清单通过校验', manifests.length === 2)
  check('导航按 order 生成', manifests.flatMap((m) => m.navItems).sort((a, b) => a.order - b.order)[0]?.to === '/mod-beta')
  const discovered = discoverMods({
    '../mods/mod-delta/manifest.ts': { default: manifest('mod-delta', 30) },
    '../mods/mod-epsilon/manifest.ts': manifest('mod-epsilon', 40),
  })
  check('新 fixture 无需改核心即可被发现', discovered.length === 2)

  let duplicateRejected = false
  try {
    validateModManifests([alpha, { ...beta, id: alpha.id }])
  } catch {
    duplicateRejected = true
  }
  check('重复 mod id 被拒绝', duplicateRejected)

  let unsafeStoreRejected = false
  try {
    validateModManifests([
      {
        ...alpha,
        dbStores: [{ ...alpha.dbStores[0]!, name: 'dailyDays' }],
      },
    ])
  } catch {
    unsafeStoreRejected = true
  }
  check('非沙箱前缀表名被拒绝', unsafeStoreRejected)

  console.log('registry lifecycle')
  const storage = memoryStorage()
  storage.setItem('knapsack.mod-state.v1', JSON.stringify({ alpha: false }))
  const registry = createModRegistry([alpha, beta], storage)
  check('旧状态键迁移到开放 mod id', registry.state['mod-alpha'] === false)
  check('默认禁用模块保持关闭', registry.state['mod-beta'] === false)
  check('仅启用模块进入导航', registry.enabledNavItems.length === 0)

  await registry.setEnabled('mod-alpha', true)
  const firstNav = registry.enabledNavItems
  check('异步开启后进入导航', firstNav.length === 1 && firstNav[0]?.to === '/mod-alpha')
  check('开启后能力总线可查询', (await registry.capabilities.query<{ id: string }>('capability:test'))[0]?.id === 'mod-alpha')
  check('开启后插槽有贡献', registry.slots.resolve('host:quick-action').length === 1)
  check('开关写入新状态键', JSON.parse(storage.getItem('knapsack.mod-state.v1') ?? '{}')['mod-alpha'] === true)

  await registry.setEnabled('mod-alpha', false)
  check('关闭后导航移除', registry.enabledNavItems.length === 0)
  check('关闭后能力查询降级为空数组', (await registry.capabilities.query('capability:test')).length === 0)
  check('关闭后插槽贡献移除', registry.slots.resolve('host:quick-action').length === 0)

  const reactiveNav = computed(() => registry.enabledNavItems.length)
  await registry.setEnabled('mod-beta', true)
  check('Vue 响应式可感知导航变化', reactiveNav.value === 1)

  const broken = {
    ...manifest('mod-broken', 50),
    providesCapabilities: {
      'capability:test': async () => {
        throw new Error('fixture provider failed')
      },
    },
  }
  const diagnosticRegistry = createModRegistry([alpha, broken], memoryStorage())
  const detailed = await diagnosticRegistry.capabilities.queryDetailed<{ id: string }>('capability:test')
  check('能力查询保留成功结果', detailed.values.length === 1 && detailed.values[0]?.id === 'mod-alpha')
  check(
    '能力查询返回失败诊断',
    detailed.failures.length === 1 && detailed.failures[0]?.modId === 'mod-broken',
  )

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
