import { nanoid } from 'nanoid'
import type { ShareablePackage } from '../../core/types/shareable-package.schema'
import { sha256Hex } from './digest-signer'

export interface ShareLineageDescriptor {
  sourceModId: `mod-${string}`
  packageType: string
  itemKeys: string[]
}

export interface ShareIdentity {
  packageId: string
  revision: number
  digest?: string
}

const STORAGE_PREFIX = 'knapsack.share.lineage.v1.'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

async function lineageKey(descriptor: ShareLineageDescriptor): Promise<string> {
  const canonical = JSON.stringify({
    sourceModId: descriptor.sourceModId,
    packageType: descriptor.packageType,
    itemKeys: [...new Set(descriptor.itemKeys)].sort(),
  })
  return `${STORAGE_PREFIX}${await sha256Hex(canonical)}`
}

function parseIdentity(raw: string | null): ShareIdentity | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ShareIdentity>
    if (
      typeof value.packageId !== 'string' ||
      value.packageId.trim().length === 0 ||
      !Number.isInteger(value.revision) ||
      (value.revision ?? 0) < 1
    ) {
      return null
    }
    return {
      packageId: value.packageId,
      revision: value.revision!,
      digest: typeof value.digest === 'string' ? value.digest : undefined,
    }
  } catch {
    return null
  }
}

export async function readShareIdentity(
  descriptor: ShareLineageDescriptor,
): Promise<ShareIdentity | null> {
  const target = storage()
  if (!target) return null
  try {
    return parseIdentity(target.getItem(await lineageKey(descriptor)))
  } catch {
    return null
  }
}

export async function writeShareIdentity(
  descriptor: ShareLineageDescriptor,
  identity: ShareIdentity,
): Promise<void> {
  const target = storage()
  if (!target) throw new Error('本机共享版本台账不可用，拒绝无版本记录地写入共享包')
  target.setItem(await lineageKey(descriptor), JSON.stringify(identity))
}

export async function nextShareIdentity(
  descriptor: ShareLineageDescriptor,
  packagePrefix: string,
): Promise<ShareIdentity> {
  const previous = await readShareIdentity(descriptor)
  return previous
    ? { packageId: previous.packageId, revision: previous.revision + 1 }
    : { packageId: `${packagePrefix}-${nanoid(18)}`, revision: 1 }
}

export async function rememberPackageLineage(
  sharePackage: ShareablePackage,
  itemKeys: string[],
): Promise<void> {
  const uniqueKeys = [...new Set(itemKeys)]
  const identity = {
    packageId: sharePackage.packageId,
    revision: sharePackage.revision,
    digest: sharePackage.digest,
  }
  await writeShareIdentity(
    {
      sourceModId: sharePackage.sourceModId,
      packageType: sharePackage.packageType,
      itemKeys: uniqueKeys,
    },
    identity,
  )
  for (const itemKey of uniqueKeys) {
    await writeShareIdentity(
      {
        sourceModId: sharePackage.sourceModId,
        packageType: sharePackage.packageType,
        itemKeys: [itemKey],
      },
      identity,
    )
  }
}

export async function prepareImportedPackage(
  sharePackage: ShareablePackage,
  itemKeys: string[],
  mode: 'MERGE' | 'LOCAL_COPY',
  localExists?: (itemKey: string) => Promise<boolean>,
): Promise<void> {
  if (mode === 'LOCAL_COPY') return
  for (const itemKey of [...new Set(itemKeys)]) {
    const existing = await readShareIdentity({
      sourceModId: sharePackage.sourceModId,
      packageType: sharePackage.packageType,
      itemKeys: [itemKey],
    })
    if (!existing) {
      if (localExists && await localExists(itemKey)) {
        throw new Error(`业务对象 ${itemKey} 已存在但没有共享版本身份，拒绝直接覆盖`)
      }
      continue
    }
    if (existing.packageId !== sharePackage.packageId) {
      throw new Error(`业务对象 ${itemKey} 已属于另一条共享包链，拒绝跨包覆盖`)
    }
    if (existing.revision > sharePackage.revision) {
      throw new Error(`业务对象 ${itemKey} 已存在更高版本 v${existing.revision}，拒绝版本回退`)
    }
    if (
      existing.revision === sharePackage.revision &&
      existing.digest &&
      existing.digest !== sharePackage.digest
    ) {
      throw new Error(`业务对象 ${itemKey} 的同版本内容冲突`)
    }
  }
  await rememberPackageLineage(sharePackage, itemKeys)
}
