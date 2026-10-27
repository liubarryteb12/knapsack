/**
 * 共享包摘要签名稳定性与篡改检测。
 */
import { createHash } from 'node:crypto'
import { signShareablePackage, verifyShareablePackage } from '../src/engines/lan-share-engine/digest-signer'
import { sha256Hex } from '../src/engines/lan-share-engine/digest-signer'
import type { ShareablePackageDraft } from '../src/core/types/shareable-package.schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

const draft: ShareablePackageDraft = {
  protocolVersion: '1.0',
  packageId: 'pkg-digest-1',
  createdAt: '2026-10-27T10:00:00+08:00',
  sourceModId: 'mod-trip',
  packageType: 'TRIP_ITINERARY',
  title: '川西行程',
  releaseNote: '秋季版本',
  permissionMode: 'READ_ONLY',
  revision: 1,
  author: { deviceId: 'device-a', nickname: '团长', role: 'HOST' },
  payload: { b: 2, a: 1, nested: { y: ['一', '二'], x: '😊' } },
}

async function main() {
  const first = await signShareablePackage(draft)
  const second = await signShareablePackage({
    ...draft,
    payload: { nested: { x: '😊', y: ['一', '二'] }, a: 1, b: 2 },
  })
  check('键顺序不影响摘要', first.digest === second.digest)
  check('合法包验签通过', await verifyShareablePackage(first))
  check('载荷被改后验签失败', !(await verifyShareablePackage({ ...first, payload: { changed: true } })))
  check(
    '创建时间被改后验签失败',
    !(await verifyShareablePackage({ ...first, createdAt: '2026-10-28T10:00:00+08:00' })),
  )
  const fullBytes = new Uint8Array([1, 2, 3, 4, 5])
  check(
    'Uint8Array 子视图只哈希自身字节',
    (await sha256Hex(fullBytes.subarray(2, 5))) ===
      createHash('sha256').update(Buffer.from([3, 4, 5])).digest('hex'),
  )
  check('摘要为 64 位十六进制', /^[a-f0-9]{64}$/.test(first.digest))
  const normalized = await signShareablePackage({
    ...draft,
    packageId: '  pkg-normalized  ',
    title: '  带空白的标题  ',
    releaseNote: undefined as never,
    revision: undefined as never,
    author: { deviceId: '  device-a  ', nickname: '  团长  ', role: 'HOST' },
  })
  check(
    '签名前先规范化字段',
    normalized.packageId === 'pkg-normalized' &&
      normalized.title === '带空白的标题' &&
      normalized.releaseNote === '' &&
      normalized.revision === 1 &&
      normalized.author.deviceId === 'device-a' &&
      (await verifyShareablePackage(normalized)),
  )
  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
