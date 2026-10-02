import { z } from 'zod'

/** AI 接口配置（本地 localStorage 存储，绝不上传） */
export const aiConfigSchema = z.object({
  baseURL: z.string().url().default('https://api.deepseek.com/v1'),
  apiKey: z.string().default(''),
  model: z.string().default('deepseek-chat'),
})

export type AiConfig = z.infer<typeof aiConfigSchema>

const STORAGE_KEY = 'knapsack.ai-config'

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return aiConfigSchema.parse({})
    return aiConfigSchema.parse(JSON.parse(raw))
  } catch {
    return aiConfigSchema.parse({})
  }
}

export function saveAiConfig(config: AiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
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
  const config = loadAiConfig()
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
