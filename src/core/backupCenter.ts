import type { KnapsackDB } from '../db'
import type { ModManifest } from './modRegistry'

export const BACKUP_FORMAT = 'knapsack-backup.v1'

export type BackupRow = Record<string, unknown>

export interface KnapsackBackup {
  format: typeof BACKUP_FORMAT
  createdAt: number
  stores: Record<string, BackupRow[]>
  moduleState: Record<string, boolean>
  warnings: string[]
  checksum: string
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupValidationError'
  }
}

function isSensitiveKey(key: string): boolean {
  return /^(credential|credentialsecret|secret|token|apikey|password|privatekey)$/i.test(key)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function encodeValue(
  value: unknown,
  state: { redacted: number },
): Promise<unknown> {
  if (value instanceof Blob) {
    return {
      __knapsackType: 'blob',
      mimeType: value.type,
      base64: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
    }
  }
  if (value instanceof Date) {
    return { __knapsackType: 'date', value: value.toISOString() }
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => encodeValue(item, state)))
  }
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        state.redacted++
        continue
      }
      output[key] = await encodeValue(item, state)
    }
    return output
  }
  return value
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue)
  if (value === null || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  if (record.__knapsackType === 'blob') {
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : ''
    const base64 = typeof record.base64 === 'string' ? record.base64 : ''
    const bytes = base64ToBytes(base64)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return new Blob([buffer], { type: mimeType })
  }
  if (record.__knapsackType === 'date' && typeof record.value === 'string') {
    return new Date(record.value)
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, decodeValue(item)]),
  )
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeForHash((value as Record<string, unknown>)[key])]),
  )
}

async function sha256(value: unknown): Promise<string> {
  const text = JSON.stringify(normalizeForHash(value))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function checksumPayload(backup: Omit<KnapsackBackup, 'checksum'>) {
  return {
    format: backup.format,
    createdAt: backup.createdAt,
    stores: backup.stores,
    moduleState: backup.moduleState,
    warnings: backup.warnings,
  }
}

export class BackupCenter {
  constructor(
    private readonly db: KnapsackDB,
    private readonly manifests: readonly ModManifest[],
    private readonly restoreModuleState?: (state: Record<string, boolean>) => Promise<void> | void,
  ) {}

  private declaredStoreNames(): Set<string> {
    return new Set(this.manifests.flatMap((manifest) => manifest.dbStores.map((store) => store.name)))
  }

  async exportBackup(moduleState: Record<string, boolean> = {}): Promise<KnapsackBackup> {
    const stores: Record<string, BackupRow[]> = {}
    const state = { redacted: 0 }
    for (const manifest of this.manifests) {
      for (const store of manifest.dbStores) {
        const rows = await this.db.table(store.name).toArray()
        stores[store.name] = (await encodeValue(rows, state)) as BackupRow[]
      }
    }
    const warnings = state.redacted > 0
      ? [`备份已脱敏 ${state.redacted} 个敏感字段；团队配对凭证恢复后需要重新配对`]
      : []
    const payload: Omit<KnapsackBackup, 'checksum'> = {
      format: BACKUP_FORMAT,
      createdAt: Date.now(),
      stores,
      moduleState: { ...moduleState },
      warnings,
    }
    return {
      ...payload,
      checksum: await sha256(checksumPayload(payload)),
    }
  }

  static stringify(backup: KnapsackBackup): string {
    return JSON.stringify(backup, null, 2)
  }

  static parse(text: string): KnapsackBackup {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new BackupValidationError('备份文件不是合法 JSON')
    }
    if (!value || typeof value !== 'object') throw new BackupValidationError('备份根对象无效')
    const backup = value as Partial<KnapsackBackup>
    if (backup.format !== BACKUP_FORMAT) throw new BackupValidationError('备份格式版本不受支持')
    if (!Number.isInteger(backup.createdAt)) throw new BackupValidationError('备份时间戳无效')
    if (!backup.stores || typeof backup.stores !== 'object') throw new BackupValidationError('备份缺少数表')
    if (!backup.moduleState || typeof backup.moduleState !== 'object') {
      throw new BackupValidationError('备份缺少模块状态')
    }
    if (!Array.isArray(backup.warnings)) throw new BackupValidationError('备份缺少警告清单')
    for (const [name, rows] of Object.entries(backup.stores)) {
      if (!Array.isArray(rows)) throw new BackupValidationError(`备份表 ${name} 不是数组`)
    }
    for (const [id, enabled] of Object.entries(backup.moduleState)) {
      if (typeof enabled !== 'boolean') throw new BackupValidationError(`模块状态 ${id} 不是布尔值`)
    }
    if (typeof backup.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(backup.checksum)) {
      throw new BackupValidationError('备份校验和格式无效')
    }
    return backup as KnapsackBackup
  }

  async importBackup(
    backup: KnapsackBackup,
    options: { skipModuleState?: boolean } = {},
  ): Promise<void> {
    const parsed = BackupCenter.parse(BackupCenter.stringify(backup))

    const declared = this.declaredStoreNames()
    const importedNames = Object.keys(parsed.stores)
    for (const name of importedNames) {
      if (!declared.has(name)) throw new BackupValidationError(`备份包含未声明存储表：${name}`)
    }
    if (importedNames.length !== declared.size) {
      throw new BackupValidationError('备份表清单不完整，拒绝部分覆盖')
    }
    const expected = await sha256(checksumPayload(parsed))
    if (expected !== parsed.checksum) throw new BackupValidationError('备份校验和不匹配，文件可能已损坏')

    const tables = [...declared].map((name) => this.db.table(name))
    await this.db.transaction('rw', tables, async () => {
      for (const name of [...declared].sort()) {
        const rows = (parsed.stores[name] ?? []).map(decodeValue) as BackupRow[]
        await this.db.table(name).clear()
        if (rows.length > 0) await this.db.table(name).bulkPut(rows)
      }
    })

    if (!options.skipModuleState) {
      await this.restoreModuleState?.(parsed.moduleState)
    }
  }
}
