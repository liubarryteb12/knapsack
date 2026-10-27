/**
 * v4 SandboxedDB expand-contract test.
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-sandboxed-db.ts
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { KnapsackDB } from '../src/db'
import { STATIC_MOD_MANIFESTS } from '../src/mods/manifest-index'
import type { ModManifest } from '../src/core/modRegistry'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function seedV4(name: string) {
  const old = new Dexie(name)
  old.version(1).stores({ trips: 'id, name, startDate' })
  old.version(2).stores({
    trips: 'id, name, startDate',
    teamState: 'teamId',
    teamPublications: 'publicationId, teamId, [teamId+version]',
    teamOutbox: 'operationId, teamId, kind, createdAt',
    teamIdempotency: 'idempotencyKey, teamId',
    teamLink: 'teamId',
  })
  old.version(3).stores({
    trips: 'id, name, startDate',
    teamState: 'teamId',
    teamPublications: 'publicationId, teamId, [teamId+version]',
    teamOutbox: 'operationId, teamId, kind, createdAt',
    teamIdempotency: 'idempotencyKey, teamId',
    teamLink: 'teamId',
    dailyDays: 'date, updatedAt',
  })
  old.version(4).stores({
    trips: 'id, name, startDate',
    teamState: 'teamId',
    teamPublications: 'publicationId, teamId, [teamId+version]',
    teamOutbox: 'operationId, teamId, kind, createdAt',
    teamIdempotency: 'idempotencyKey, teamId',
    teamLink: 'teamId',
    dailyDays: 'date, updatedAt',
    financeEntries: 'id, date, category, &sourceKey, [date+category]',
  })
  await old.open()
  await old.table('trips').put({ id: 'trip-1', name: '旧行程', startDate: '2026-10-01' })
  await old.table('teamState').put({ teamId: 'team-1', name: '旧团队' })
  await old.table('dailyDays').put({ date: '2026-10-01', updatedAt: 1, memo: '旧备忘' })
  await old.table('financeEntries').put({
    id: 'fin-1',
    date: '2026-10-01',
    category: 'food',
    sourceKey: 'manual:fin-1',
    amountFen: 100,
  })
  old.close()
}

async function main() {
  const dbName = `knapsack-sandbox-test-${Date.now()}`
  await Dexie.delete(dbName)
  await seedV4(dbName)

  const fixture: ModManifest = {
    ...STATIC_MOD_MANIFESTS[0]!,
    id: 'mod-fixture',
    name: '测试卡带',
    schemaRevision: 2,
    dbStores: [
      {
        name: 'mod_fixture_items',
        keyPath: 'id',
        indexes: [{ name: 'createdAt', keyPath: 'createdAt' }],
      },
    ],
    routes: [{ path: '/fixture', name: 'fixture', component: { render: () => null } }],
    navItems: [{ ...STATIC_MOD_MANIFESTS[0]!.navItems[0]!, to: '/fixture', order: 99 }],
  }
  const manifests = [...STATIC_MOD_MANIFESTS, fixture]
  const upgraded = new KnapsackDB(dbName, manifests)
  await upgraded.open()

  const tableNames = new Set(upgraded.tables.map((table) => table.name))
  check('旧 trips 表保留', tableNames.has('trips'))
  check('旧 dailyDays 表保留', tableNames.has('dailyDays'))
  check('沙箱 trips 镜像已创建', tableNames.has('mod_trip_trips'))
  check('沙箱财务表已创建', tableNames.has('mod_finance_entries'))
  check('第四张 fixture 卡带表自动创建', tableNames.has('mod_fixture_items'))
  check('旧 trips 数据未删除', (await upgraded.table('trips').count()) === 1)
  check('trip 镜像内容一致', (await upgraded.table('mod_trip_trips').get('trip-1'))?.name === '旧行程')
  check('mod_trip 团队表作为过渡表保留', tableNames.has('mod_trip_team_state'))
  check('mod-team 群组表从最旧 v4 数据迁移', (await upgraded.table('mod_team_groups').get('team-1'))?.name === '旧团队')
  check('mod-team 数据包历史表自动创建', tableNames.has('mod_team_packages'))
  check('daily 镜像内容一致', (await upgraded.table('mod_daily_days').get('2026-10-01'))?.memo === '旧备忘')
  check('finance 镜像内容一致', (await upgraded.table('mod_finance_entries').get('fin-1'))?.amountFen === 100)

  upgraded.close()
  await Dexie.delete(dbName)
  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
