import { z } from 'zod'

export const SHAREABLE_PACKAGE_PROTOCOL = '1.0'
export const SHAREABLE_PACKAGE_EXPORT_TOPIC = 'capability:shareable-package-export' as const
export const SHAREABLE_PACKAGE_IMPORT_TOPIC = 'capability:shareable-package-import' as const

export const packagePermissionModeSchema = z.enum(['READ_ONLY', 'COLLABORATIVE'])
export const packageAuthorRoleSchema = z.enum(['HOST', 'MEMBER', 'OBSERVER'])

export interface ShareablePackageAuthor {
  deviceId: string
  nickname: string
  role: z.infer<typeof packageAuthorRoleSchema>
}

export interface ShareablePackage<T = unknown> {
  protocolVersion: '1.0'
  packageId: string
  createdAt: string
  sourceModId: `mod-${string}`
  packageType: string
  title: string
  releaseNote: string
  permissionMode: z.infer<typeof packagePermissionModeSchema>
  revision: number
  author: ShareablePackageAuthor
  payload: T
  digest: string
}

export interface ShareablePackageDraft<T = unknown>
  extends Omit<ShareablePackage<T>, 'protocolVersion' | 'digest'> {
  protocolVersion?: '1.0'
}

export interface ShareablePackageExportRequest {
  sourceModId?: `mod-${string}`
  packageType?: string
  itemIds?: string[]
  permissionMode?: z.infer<typeof packagePermissionModeSchema>
}

export interface ShareablePackageImportRequest {
  package: ShareablePackage
  groupId?: string
  approvedByHost: boolean
  mode?: 'MERGE' | 'LOCAL_COPY'
}

export interface ShareablePackageImportResult {
  packageId: string
  accepted: boolean
  message: string
}

export type ShareablePackageExporter = (
  request?: ShareablePackageExportRequest,
) => Promise<ShareablePackage[]>

export type ShareablePackageImporter = (
  request: ShareablePackageImportRequest,
) => Promise<ShareablePackageImportResult>

const INVALID_JSON_PAYLOAD = 'payload 必须是可 JSON 序列化的纯数据'

function normalizeJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): unknown {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    throw new Error(`${INVALID_JSON_PAYLOAD}: ${path} 包含非有限数字`)
  }
  if (typeof value !== 'object') {
    throw new Error(`${INVALID_JSON_PAYLOAD}: ${path} 包含 ${typeof value}`)
  }
  if (ancestors.has(value)) {
    throw new Error(`${INVALID_JSON_PAYLOAD}: ${path} 包含循环引用`)
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) =>
        value[index] === undefined
          ? null
          : normalizeJsonValue(value[index], `${path}[${index}]`, ancestors),
      )
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${INVALID_JSON_PAYLOAD}: ${path} 不是普通对象`)
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${INVALID_JSON_PAYLOAD}: ${path} 包含 Symbol 字段`)
    }
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key]
      if (item === undefined) continue
      normalized[key] = normalizeJsonValue(item, `${path}.${key}`, ancestors)
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

const jsonPayloadSchema = z.unknown().transform((value, ctx) => {
  try {
    return normalizeJsonValue(value, 'payload', new Set())
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : INVALID_JSON_PAYLOAD,
    })
    return z.NEVER
  }
})

export const shareablePackageAuthorSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  nickname: z.string().trim().min(1).max(80),
  role: packageAuthorRoleSchema,
})

export const shareablePackageDraftSchema = z.object({
  protocolVersion: z.literal(SHAREABLE_PACKAGE_PROTOCOL),
  packageId: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }),
  sourceModId: z.string().regex(/^mod-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  packageType: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  releaseNote: z.string().max(200).default(''),
  permissionMode: packagePermissionModeSchema,
  revision: z.number().int().min(1).default(1),
  author: shareablePackageAuthorSchema,
  payload: jsonPayloadSchema,
})

export const shareablePackageSchema = shareablePackageDraftSchema.extend({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})

export function parseShareablePackage(value: unknown): ShareablePackage {
  return shareablePackageSchema.parse(value) as ShareablePackage
}
