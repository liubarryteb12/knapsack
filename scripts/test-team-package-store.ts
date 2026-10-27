/**
 * mod-team 共享包记录存储与审核状态。
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../src/db'
import { signShareablePackage } from '../src/engines/lan-share-engine/digest-signer'
import {
  TEAM_PACKAGE_RECORD_FORMAT,
  teamPackageRecordSchema,
} from '../src/mods/mod-team/schema/team-package.schema'
import { useTeamPackageStore } from '../src/mods/mod-team/store/teamPackageStore'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function main() {
  setActivePinia(createPinia())
  await db.teamPackages.clear()
  const shared = await signShareablePackage({
    protocolVersion: '1.0',
    packageId: 'team-package-test-1',
    createdAt: '2026-10-27T11:00:00+08:00',
    sourceModId: 'mod-prompts',
    packageType: 'PROMPT_COLLECTION',
    title: '测试提示词包',
    releaseNote: '团队包记录测试',
    permissionMode: 'COLLABORATIVE',
    revision: 1,
    author: { deviceId: 'device-a', nickname: '团长', role: 'HOST' },
    payload: { items: [{ id: 'p1', title: '评审' }] },
  })
  const store = useTeamPackageStore()
  await store.load()
  check('初始共享包为空', store.records.length === 0)

  const record = await store.save({
    format: TEAM_PACKAGE_RECORD_FORMAT,
    recordId: 'record-1',
    groupId: 'group-1',
    packageId: shared.packageId,
    direction: 'RECEIVED',
    status: 'PENDING_REVIEW',
    package: shared,
    previousPackage: null,
    createdAt: 1,
    updatedAt: 1,
  })
  check('共享包记录可保存', teamPackageRecordSchema.safeParse(record).success)
  check('待审记录计数正确', store.pending.length === 1)

  await store.setStatus(record.recordId, 'ACCEPTED')
  check('审核状态可推进', store.records[0]?.status === 'ACCEPTED' && store.pending.length === 0)

  const sharedV2 = await signShareablePackage({
    protocolVersion: '1.0',
    packageId: shared.packageId,
    createdAt: '2026-10-27T11:01:00+08:00',
    sourceModId: 'mod-prompts',
    packageType: 'PROMPT_COLLECTION',
    title: '测试提示词包',
    releaseNote: '第二版',
    permissionMode: 'COLLABORATIVE',
    revision: 2,
    author: { deviceId: 'device-a', nickname: '团长', role: 'HOST' },
    payload: { items: [{ id: 'p1', title: '评审 v2' }] },
  })
  const sharedV3 = await signShareablePackage({
    protocolVersion: '1.0',
    packageId: shared.packageId,
    createdAt: '2026-10-27T11:02:00+08:00',
    sourceModId: 'mod-prompts',
    packageType: 'PROMPT_COLLECTION',
    title: '测试提示词包',
    releaseNote: '第三版',
    permissionMode: 'COLLABORATIVE',
    revision: 3,
    author: { deviceId: 'device-a', nickname: '团长', role: 'HOST' },
    payload: { items: [{ id: 'p1', title: '评审 v3' }] },
  })
  await store.saveMany([
    {
      ...record,
      recordId: 'record-v1',
      status: 'PENDING_REVIEW',
      package: shared,
      previousPackage: null,
      updatedAt: 2,
    },
    {
      ...record,
      recordId: 'record-v2',
      status: 'PENDING_REVIEW',
      package: sharedV2,
      previousPackage: shared,
      updatedAt: 3,
    },
  ])
  check('同一包只展示最高待审版本', store.pending.length === 1 && store.pending[0]?.recordId === 'record-v2')
  await store.setStatus('record-v2', 'ACCEPTED')
  check('采纳高版本后低版本不重新待审', store.pending.length === 0)
  await store.save({
    ...record,
    recordId: 'record-v3',
    status: 'PENDING_REVIEW',
    package: sharedV3,
    previousPackage: sharedV2,
    updatedAt: 4,
  })
  check('更高新版本仍可进入待审', store.pending.length === 1 && store.pending[0]?.recordId === 'record-v3')

  await db.teamPackages.clear()
  await store.load()
  let invalidBatchRejected = false
  try {
    await store.saveMany([
      {
        ...record,
        recordId: 'record-batch-ok',
        package: sharedV3,
        previousPackage: sharedV2,
      },
      {
        ...record,
        recordId: 'record-batch-invalid',
        package: { broken: true } as never,
      },
    ])
  } catch {
    invalidBatchRejected = true
  }
  check('批量装箱任一失败时整批不落库', invalidBatchRejected && (await db.teamPackages.count()) === 0)

  await store.load()
  check('空库重新加载保持空状态', store.records.length === 0)
  await db.teamPackages.clear()
  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
