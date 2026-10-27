import { nanoid } from 'nanoid'
import { promptItemSchema, type PromptItem } from './schema'

const PROMPT_SHARE_PREFIX = 'knapsack-prompt/1?d='

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * A compact, transport-only prompt projection. Local IDs, usage statistics and
 * edit history stay on the originating device.
 */
export function encodePromptShare(item: PromptItem, now = Date.now()): string {
  const parsed = promptItemSchema.parse(item)
  const payload = {
    v: 1,
    t: parsed.title,
    m: parsed.modality,
    f: [
      parsed.facets.targetTool,
      parsed.facets.domainTheme,
      parsed.facets.styleTechnique,
    ],
    p: parsed.payload,
    at: now,
  }
  return PROMPT_SHARE_PREFIX + bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
}

export function decodePromptShare(code: string, now = Date.now()): PromptItem {
  const text = code.trim()
  if (!text.startsWith(PROMPT_SHARE_PREFIX)) throw new Error('这不是行囊提示词分享码')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(
      base64UrlToBytes(text.slice(PROMPT_SHARE_PREFIX.length)),
    ))
  } catch {
    throw new Error('提示词分享码已损坏')
  }
  if (!value || typeof value !== 'object') throw new Error('提示词分享码结构无效')
  const data = value as {
    v?: unknown
    t?: unknown
    m?: unknown
    f?: unknown
    p?: unknown
    at?: unknown
  }
  if (data.v !== 1 || !Array.isArray(data.f) || data.f.length !== 3) {
    throw new Error('提示词分享码版本或标签结构不受支持')
  }
  const [targetTool, domainTheme, styleTechnique] = data.f
  return promptItemSchema.parse({
    id: nanoid(12),
    title: data.t,
    modality: data.m,
    facets: { targetTool, domainTheme, styleTechnique },
    isFavorite: false,
    usageCount: 0,
    version: 1,
    history: [],
    createdAt: now,
    updatedAt: now,
    payload: data.p,
  })
}
