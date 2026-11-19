import {
  decodePromptShareCode,
  encodePromptShare,
  encodePromptShareCompact,
} from './shareCode'
import type { PromptItem } from './schema'

export const PROMPT_SHARE_LINK_BASE = 'knapsack-prompt://share?d='

function extractShareValue(input: string): string {
  const text = input.trim()
  if (!text) throw new TypeError('分享链接不能为空')
  if (text.startsWith('knapsack-prompt/')) return text

  const legacyPrefix = 'https://liubarryteb12.github.io/knapsack/#/prompts?share='
  if (text.startsWith(legacyPrefix)) {
    return decodeURIComponent(text.slice(legacyPrefix.length))
  }

  try {
    const url = new URL(text)
    const direct = url.searchParams.get('d') ?? url.searchParams.get('share')
    if (direct) return direct
    const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : ''
    const fromHash = new URLSearchParams(hashQuery).get('d')
      ?? new URLSearchParams(hashQuery).get('share')
    if (fromHash) return fromHash
  } catch {
    /* A raw code or a URL embedded in a chat message is handled below. */
  }

  const match = /(?:knapsack-prompt:\/\/share\?|[?&#])(?:d|share)=([^&\s]+)/.exec(text)
  if (match?.[1]) return decodeURIComponent(match[1])
  throw new Error('这不是行囊提示词分享链接')
}

export async function encodePromptShareLink(
  item: PromptItem,
  now = Date.now(),
): Promise<string> {
  let code: string
  try {
    code = await encodePromptShareCompact(item, now)
  } catch {
    code = encodePromptShare(item, now)
  }
  return PROMPT_SHARE_LINK_BASE + encodeURIComponent(code)
}

export async function decodePromptShareLink(
  input: string,
  now = Date.now(),
): Promise<PromptItem> {
  return decodePromptShareCode(extractShareValue(input), now)
}
