import { z } from 'zod'
import type { AiConfig } from '../../../utils/aiConfig'
import {
  buildClarifyPrompt,
  buildDecomposePrompt,
  PROMPT_VERSION,
  type ClarificationAnswer,
  type ClarificationQuestion,
} from '../prompts'
import { goalPackSchema, type GoalPack } from '../schema'

export { PROMPT_VERSION }

export class AiDecomposeError extends Error {}

const clarificationSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        why: z.string().default(''),
        layer: z.enum(['goal', 'milestone', 'task', 'cycle']).default('goal'),
      }),
    )
    .min(1)
    .max(6),
})

/** 从 AI 返回文本中提取 JSON（容忍 ```json 包裹与前后废话） */
export function extractJson(text: string): unknown {
  let raw = text.trim()
  const fence = /```(?:json|goal-pack)?\s*([\s\S]*?)```/.exec(raw)
  if (fence?.[1]) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AiDecomposeError('返回内容里找不到 JSON 对象')
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch (error) {
    throw new AiDecomposeError(
      `返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function callChat(
  config: AiConfig,
  prompt: string,
  options: { temperature: number; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  if (!config.apiKey) throw new AiDecomposeError('未配置 API Key')

  // 手动组合超时与外部取消，避免依赖 AbortSignal.any（旧 WebView 不支持）
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  const onExternalAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort)

  let resp: Response
  try {
    resp = await fetch(`${config.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw new AiDecomposeError('已取消')
    throw new AiDecomposeError('网络不通或请求超时')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new AiDecomposeError(`接口返回 ${resp.status}${body ? `：${body.slice(0, 200)}` : ''}`)
  }

  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new AiDecomposeError('接口返回里没有内容')
  return content
}

function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || '根'}：${issue.message}`)
    .join('；')
}

/** 第 1 轮：只出澄清问题，失败回喂错误重试 1 次 */
export async function askClarifications(
  config: AiConfig,
  ideaText: string,
  signal?: AbortSignal,
): Promise<ClarificationQuestion[]> {
  const prompt = buildClarifyPrompt(ideaText)
  const first = await callChat(config, prompt, { temperature: 0.7, timeoutMs: 30_000, signal })
  const firstParsed = clarificationSchema.safeParse(extractJson(first))
  if (firstParsed.success) return firstParsed.data.questions

  const retryPrompt = [
    prompt,
    '',
    '## 上一次输出的问题',
    `你上次的输出未通过校验：${issuesText(firstParsed.error)}`,
    '请严格按输出格式重新只输出一个合法 JSON 对象。',
  ].join('\n')
  const second = await callChat(config, retryPrompt, { temperature: 0.7, timeoutMs: 30_000, signal })
  const secondParsed = clarificationSchema.safeParse(extractJson(second))
  if (secondParsed.success) return secondParsed.data.questions
  throw new AiDecomposeError(`AI 两次输出均不合规：${issuesText(secondParsed.error)}`)
}

/** 第 2 轮：产出 goal-pack，校验失败回喂错误重试 1 次 */
export async function decompose(
  config: AiConfig,
  ideaText: string,
  qa: ClarificationAnswer[],
  signal?: AbortSignal,
): Promise<{ pack: GoalPack; raw: string; retried: boolean }> {
  const prompt = buildDecomposePrompt(ideaText, qa)

  const tryParse = (text: string): GoalPack => {
    const parsed = goalPackSchema.safeParse(extractJson(text))
    if (!parsed.success) throw new AiDecomposeError(`goal-pack 校验失败：${issuesText(parsed.error)}`)
    return { ...parsed.data, source: 'knapsack-ai' }
  }

  let firstRaw = ''
  try {
    const first = await callChat(config, prompt, { temperature: 0.3, timeoutMs: 90_000, signal })
    firstRaw = first
    return { pack: tryParse(first), raw: first, retried: false }
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError)
    const retryPrompt = [
      prompt,
      '',
      '## 上一次输出的问题',
      `你上次的输出未通过校验：${message}`,
      '请严格按硬性约束重新只输出一个合法 JSON 对象。',
    ].join('\n')
    try {
      const second = await callChat(config, retryPrompt, {
        temperature: 0.3,
        timeoutMs: 90_000,
        signal,
      })
      return { pack: tryParse(second), raw: second, retried: true }
    } catch (secondError) {
      const secondMessage = secondError instanceof Error ? secondError.message : String(secondError)
      throw new AiDecomposeError(
        `AI 输出两次均未通过校验。\n第一次：${message}\n第二次：${secondMessage}\n\n原文：\n${firstRaw.slice(0, 800)}`,
      )
    }
  }
}
