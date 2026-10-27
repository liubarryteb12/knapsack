/**
 * v4 统一备份格式、校验和、敏感字段与事务恢复契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-backup-center.ts
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { KnapsackDB } from '../src/db'
import { BackupCenter, BackupValidationError } from '../src/core/backupCenter'
import { STATIC_MOD_MANIFESTS } from '../src/mods/manifest-index'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function expectValidationError(name: string, action: () => Promise<unknown>) {
  try {
    await action()
    check(name, false)
  } catch (error) {
    check(name, error instanceof BackupValidationError)
  }
}

async function main() {
  const dbName = `knapsack-backup-test-${Date.now()}`
  await Dexie.delete(dbName)
  const db = new KnapsackDB(dbName, STATIC_MOD_MANIFESTS)
  await db.open()

  await db.table('mod_trip_trips').put({
    id: 'trip-backup-1',
    name: '备份行程',
    startDate: '2026-10-27',
  })
  await db.table('mod_team_groups').put({
    teamId: 'team-backup-1',
    name: '备份团队',
    credentialSecret: 'must-not-leak',
  })
  await db.table('mod_team_link').put({
    teamId: 'team-backup-1',
    memberId: 'member-1',
    credential: 'pairing-secret-must-not-leak',
  })
  await db.table('mod_prompts_items').put({
    id: 'prompt-backup-1',
    title: '备份提示词',
    modality: 'WORK_LLM',
    facets: { targetTool: [], domainTheme: [], styleTechnique: [] },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: 1,
    updatedAt: 1,
    payload: {
      systemRole: '',
      templateBody: '备份 {{主题}}',
      fewShotExamples: [],
      outputFormat: 'PLAIN',
    },
  })
  await db.table('mod_prompts_media').put({
    mediaId: 'media-backup-1',
    itemId: 'prompt-backup-1',
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' }),
    mimeType: 'image/webp',
    byteLength: 4,
    longEdge: 100,
    createdAt: 1,
  })

  const center = new BackupCenter(db, STATIC_MOD_MANIFESTS)
  const backup = await center.exportBackup({ 'mod-trip': true })
  const json = BackupCenter.stringify(backup)

  check('备份格式版本固定', backup.format === 'knapsack-backup.v1')
  check('包含全部 Manifest 声明表', backup.stores.mod_prompts_media !== undefined)
  check('敏感凭证明文不进入备份', !json.includes('must-not-leak') && !json.includes('pairing-secret'))
  check('备份记录发生脱敏警告', backup.warnings.some((warning) => warning.includes('敏感')))
  check('Blob 被编码为可移植数据', json.includes('__knapsackType') && json.includes('base64'))
  check('备份内嵌 SHA-256', /^[a-f0-9]{64}$/.test(backup.checksum))

  const parsed = BackupCenter.parse(json)
  check('合法备份可解析', parsed.checksum === backup.checksum)

  await center.importBackup(parsed, { skipModuleState: true })
  const media = await db.table('mod_prompts_media').get('media-backup-1')
  check('恢复后提示词仍在', (await db.table('mod_prompts_items').get('prompt-backup-1'))?.title === '备份提示词')
  check('恢复后 Blob 字节一致', media?.blob instanceof Blob && media.blob.size === 4)

  const beforeBadRestore = await db.table('mod_trip_trips').count()
  const corrupted = {
    ...backup,
    checksum: '0'.repeat(64),
  }
  await expectValidationError('篡改校验和会被拒绝', () => center.importBackup(corrupted))
  check('校验失败不修改现有数据', (await db.table('mod_trip_trips').count()) === beforeBadRestore)

  const unknownStore = {
    ...backup,
    stores: {
      ...backup.stores,
      undeclared_store: [],
    },
  }
  await expectValidationError('未声明存储表会被拒绝', () => center.importBackup(unknownStore))

  db.close()
  await Dexie.delete(dbName)
  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
