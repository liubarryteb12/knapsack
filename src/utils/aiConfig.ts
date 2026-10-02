import { z } from 'zod'

/**
 * AI 接口配置（阶段10 + 安全加固）
 *
 * 存储：localStorage（不上传任何服务器）。
 * API Key 不再明文落盘——首次使用时生成一台设备一份的随机主密钥（KEK），
 * 用 AES-256-GCM 把 Key 加成密文再存。拿到存储文件也只见密文，
 * 除非攻击者能同时读 localStorage 并在浏览器里执行代码（即已被 XSS 攻陷）。
 * 迁移：读到旧版明文字段时自动加密升级，用户无感。
 */

export const aiConfigSchema = z.object({
  baseURL: z.string().url().default('https://api.deepseek.com/v1'),
  apiKey: z.string().default(''),
  model: z.string().default('deepseek-chat'),
})

export type AiConfig = z.infer<typeof aiConfigSchema>

const STORAGE_KEY = 'knapsack.ai-config'
const MASTER_KEY = 'knapsack.kek'

interface StoredConfig {
  baseURL?: string
  model?: string
  /** 新版：密文信封 */
  apiKeyEnc?: string
  /** 旧版遗留：明文 Key，读到即升级 */
  apiKey?: string
}

// ---------- 主密钥（KEK） ----------

function toB64url(b: Uint8Array): string {
  let bin = ''
  for (const byte of b) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function getKek(): Promise<CryptoKey> {
  let raw = localStorage.getItem(MASTER_KEY)
  if (!raw) {
    raw = toB64url(crypto.getRandomValues(new Uint8Array(32)))
    localStorage.setItem(MASTER_KEY, raw)
  }
  return crypto.subtle.importKey('raw', b64urlToBytes(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function sealKey(plain: string): Promise<string> {
  const kek = await getKek()
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      kek,
      new TextEncoder().encode(plain),
    ),
  )
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce, 0)
  out.set(ct, 12)
  return toB64url(out)
}

async function openKey(envelope: string): Promise<string> {
  const kek = await getKek()
  const msg = b64urlToBytes(envelope)
  const nonce = msg.subarray(0, 12)
  const ct = msg.subarray(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, kek, ct)
  return new TextDecoder().decode(plain)
}

// ---------- 读写 ----------

function loadStored(): StoredConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredConfig
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

export function loadAiConfig(): AiConfig {
  const stored = loadStored()
  return aiConfigSchema.parse({
    baseURL: stored?.baseURL,
    model: stored?.model,
    // 明文字段兜底：加密读取失败或不存在时都落到空串，由界面提示补配
    apiKey: '',
  })
}

/** Key 单独异步读：解密失败视为损坏，返回空串让用户重新填 */
export async function loadApiKey(): Promise<string> {
  const stored = loadStored()
  if (!stored) return ''
  if (stored.apiKeyEnc) {
    try {
      return await openKey(stored.apiKeyEnc)
    } catch {
      return ''
    }
  }
  // 旧版明文：读出来升级成密文
  if (stored.apiKey) {
    const legacy = stored.apiKey
    await saveAiConfig({ ...loadAiConfig(), apiKey: legacy })
    return legacy
  }
  return ''
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  const stored: StoredConfig = {
    baseURL: config.baseURL,
    model: config.model,
    apiKeyEnc: config.apiKey ? await sealKey(config.apiKey) : undefined,
  }
  // 彻底移除旧版明文字段
  localStorage.removeItem(STORAGE_KEY)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

/** 测试连接：调 models 列表接口，2xx 即成功 */
export async function testAiConnection(config: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(`${config.baseURL.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    if (resp.ok) return { ok: true, message: '连接成功' }
    if (resp.status === 401) return { ok: false, message: 'API Key 无效（401）' }
    return { ok: false, message: `服务返回 ${resp.status}` }
  } catch {
    return { ok: false, message: '网络不通或地址错误' }
  }
}

/**
 * 探测 AI 接口是否真的可达，用于决定「AI 行程草稿」按钮是否置灰。
 *
 * 不能用 navigator.onLine：安卓 WebView 在没有任何默认网络时仍返回 true，
 * 所以这里真发一次请求。只要拿到 HTTP 响应就算可达（401/403 说明网络是通的，
 * Key 的问题由弹窗单独提示）。
 */
export async function checkAiReachable(timeoutMs = 4000): Promise<boolean> {
  const config = await loadAiConfigWithKey()
  try {
    await fetch(`${config.baseURL.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return true
  } catch {
    return false
  }
}

/** 带 Key 的完整配置；探活/生成等需要真实 Key 的路径统一走这里 */
export async function loadAiConfigWithKey(): Promise<AiConfig> {
  return { ...(await loadAiConfig()), apiKey: await loadApiKey() }
}

/**
 * 拉取模型列表：调 OpenAI 兼容的 /models，返回模型 id 数组。
 * 不同服务返回结构可能略有差异，这里只认 data[].id（OpenAI 规范）。
 */
export async function fetchModelList(
  config: AiConfig,
  timeoutMs = 10000,
): Promise<{ ok: boolean; models: string[]; message: string }> {
  try {
    const resp = await fetch(`${config.baseURL.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (resp.status === 401) return { ok: false, models: [], message: 'API Key 无效（401）' }
    if (!resp.ok) return { ok: false, models: [], message: `服务返回 ${resp.status}` }
    const data = (await resp.json()) as { data?: Array<{ id?: unknown }> }
    const models = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (models.length === 0) return { ok: false, models: [], message: '接口没有返回可用的模型' }
    return { ok: true, models, message: `已获取 ${models.length} 个模型` }
  } catch {
    return { ok: false, models: [], message: '网络不通或地址错误' }
  }
}
