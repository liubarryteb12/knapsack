import { nanoid } from 'nanoid'
import { promptItemSchema, type PromptItem } from './schema'

const PROMPT_SHARE_PREFIX = 'knapsack-prompt/1?d='
const PROMPT_SHARE_COMPRESSED_PREFIX = 'knapsack-prompt/2?d='

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function gzip(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream !== 'function') {
    throw new Error('当前运行时不支持分享链接压缩')
  }
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前运行时不支持分享链接解压')
  }
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * A compact, transport-only prompt projection. Local IDs, usage statistics and
 * edit history stay on the originating device.
 */
function promptSharePayload(item: PromptItem, now: number): string {
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
  return JSON.stringify(payload)
}

function promptItemFromPayload(value: unknown, now: number): PromptItem {
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

export function encodePromptShare(item: PromptItem, now = Date.now()): string {
  return PROMPT_SHARE_PREFIX + bytesToBase64Url(
    new TextEncoder().encode(promptSharePayload(item, now)),
  )
}

export async function encodePromptShareCompact(
  item: PromptItem,
  now = Date.now(),
): Promise<string> {
  const compressed = await gzip(new TextEncoder().encode(promptSharePayload(item, now)))
  return PROMPT_SHARE_COMPRESSED_PREFIX + bytesToBase64Url(compressed)
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
  return promptItemFromPayload(value, now)
}

export async function decodePromptShareCode(
  code: string,
  now = Date.now(),
): Promise<PromptItem> {
  const text = code.trim()
  if (text.startsWith(PROMPT_SHARE_PREFIX)) return decodePromptShare(text, now)
  if (!text.startsWith(PROMPT_SHARE_COMPRESSED_PREFIX)) {
    throw new Error('这不是行囊提示词分享码')
  }
  let value: unknown
  try {
    const compressed = base64UrlToBytes(text.slice(PROMPT_SHARE_COMPRESSED_PREFIX.length))
    const plain = await gunzip(compressed)
    value = JSON.parse(new TextDecoder().decode(plain))
  } catch {
    throw new Error('提示词分享码已损坏')
  }
  return promptItemFromPayload(value, now)
}
