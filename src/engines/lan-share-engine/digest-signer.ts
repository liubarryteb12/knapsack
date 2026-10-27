import type {
  ShareablePackage,
  ShareablePackageDraft,
} from '../../core/types/shareable-package.schema'
import {
  parseShareablePackage,
  shareablePackageDraftSchema,
} from '../../core/types/shareable-package.schema'

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize((value as Record<string, unknown>)[key])]),
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === 'string'
      ? new Uint8Array(new TextEncoder().encode(value).buffer as ArrayBuffer)
      : new Uint8Array(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function digestSourceFromDraft(draft: ShareablePackageDraft): Record<string, unknown> {
  return {
    protocolVersion: draft.protocolVersion ?? '1.0',
    packageId: draft.packageId,
    createdAt: draft.createdAt,
    sourceModId: draft.sourceModId,
    packageType: draft.packageType,
    title: draft.title,
    releaseNote: draft.releaseNote,
    permissionMode: draft.permissionMode,
    revision: draft.revision,
    author: draft.author,
    payload: draft.payload,
  }
}

export async function signShareablePackage<T>(
  draft: ShareablePackageDraft<T>,
): Promise<ShareablePackage<T>> {
  const normalized = shareablePackageDraftSchema.parse({
    ...draft,
    protocolVersion: '1.0',
  }) as ShareablePackageDraft<T>
  const digest = await sha256Hex(canonicalJson(digestSourceFromDraft(normalized)))
  return parseShareablePackage({
    ...normalized,
    digest,
  }) as ShareablePackage<T>
}

export async function verifyShareablePackage<T>(
  packageValue: ShareablePackage<T>,
): Promise<boolean> {
  const expected = await sha256Hex(canonicalJson(digestSourceFromDraft(packageValue)))
  return expected === packageValue.digest
}
