import { z } from 'zod'
import { tripSchema, tripDaySchema } from '../schema/trip'
import type { AiConfig } from './aiConfig'

/**
 * 阶段10：AI 行程草稿。
 * 流程：生成 → Zod 校验 → 失败回喂报错重试 1 次 → 再失败展示原文。
 * 只能生成到新旅行，绝不覆盖现有数据。
 */

/** AI 输出校验：宽松版 trip（不含 format/id 等由我们补的字段） */
export const aiDraftSchema = z.object({
  name: z.string().min(1),
  destCity: z.string().default(''),
  days: z.array(tripDaySchema).min(1),
})

export type AiDraft = z.infer<typeof aiDraftSchema>

/** 四段式提示词：任务说明 / 字段规范（来自 Zod Schema 描述）/ 输出示例 / 硬性约束 */
export function buildPrompt(userWish: string, startDate: string, endDate: string): string {
  return [
    '## 任务',
    '你是旅行规划师。根据用户需求，生成一份行程安排。',
    `旅行日期范围：${startDate} 至 ${endDate}。`,
    `用户需求：${userWish}`,
    '',
    '## 字段规范',
    '输出 JSON 对象，字段如下：',
    '- name: string，旅行名称（简短中文）',
    '- destCity: string，目的地城市名',
    '- days: 数组，每天一个对象',
    '  - date: string，日期，格式 yyyy-MM-dd，必须在旅行日期范围内，按天升序',
    '  - items: 数组，当天安排，每项：',
    '    - time: string|null，时间 HH:mm（如 "09:00"），不确定可为 null',
    '    - type: "transport" | "stay" | "food" | "play" | "other" 之一',
    '    - title: string，安排标题（简短中文）',
    '    - note: string，补充说明（交通车次、地址、贴士），无则空字符串',
    '',
    '## 输出示例',
    '{',
    '  "name": "杭州两日行",',
    '  "destCity": "杭州",',
    '  "days": [',
    '    { "date": "2026-05-01", "items": [',
    '      { "time": "09:00", "type": "transport", "title": "高铁去杭州", "note": "G7349 虹桥 8:12 开" },',
    '      { "time": "12:00", "type": "food", "title": "午餐：知味观", "note": "" }',
    '    ] }',
    '  ]',
    '}',
    '',
    '## 硬性约束',
    '1. 只准输出一个 JSON 对象，禁止任何解释文字、Markdown 代码块标记或前后缀。',
    '2. date 必须覆盖从第一天到最后一天的每一天，不允许跳天。',
    '3. 所有字符串用中文（专有名词除外）。',
  ].join('\n')
}

/** 从 AI 返回文本中提取 JSON（容忍 ```json 包裹） */
export function extractJson(text: string): unknown {
  let raw = text.trim()
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) raw = fenceMatch[1]!.trim()
  // 截取第一个 { 到最后一个 }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('返回内容里找不到 JSON 对象')
  return JSON.parse(raw.slice(start, end + 1))
}

export class AiError extends Error {}

/** 调用 OpenAI 兼容接口生成草稿，失败带报错重试 1 次 */
export async function generateDraft(
  config: AiConfig,
  userWish: string,
  startDate: string,
  endDate: string,
): Promise<{ draft: AiDraft; raw: string; retried: boolean }> {
  const prompt = buildPrompt(userWish, startDate, endDate)
  let firstRaw = ''
  try {
    const first = await callChat(config, prompt)
    firstRaw = first
    return { draft: parseDraft(first), raw: first, retried: false }
  } catch (firstErr) {
    const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
    // 回喂报错重试 1 次
    const retryPrompt = [
      prompt,
      '',
      '## 上一次输出的问题',
      `你上次的输出未通过校验：${errMsg}`,
      '请严格按硬性约束重新输出，只输出一个合法 JSON 对象。',
    ].join('\n')
    try {
      const second = await callChat(config, retryPrompt)
      return { draft: parseDraft(second), raw: second, retried: true }
    } catch (secondErr) {
      const secondMsg = secondErr instanceof Error ? secondErr.message : String(secondErr)
      throw new AiError(
        `AI 输出两次均未通过校验。\n第一次：${errMsg}\n第二次：${secondMsg}\n\n原文：\n${firstRaw.slice(0, 800)}`,
      )
    }
  }
}

async function callChat(config: AiConfig, prompt: string): Promise<string> {
  if (!config.apiKey) throw new AiError('未配置 API Key')
  const resp = await fetch(`${config.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new AiError(`接口返回 ${resp.status}${body ? `：${body.slice(0, 200)}` : ''}`)
  }
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new AiError('接口返回里没有内容')
  return content
}

/** 校验 AI 输出并转成 AiDraft */
export function parseDraft(text: string): AiDraft {
  const json = extractJson(text)
  const result = aiDraftSchema.safeParse(json)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new AiError(`${issue?.path.join('.') || '根'}：${issue?.message ?? '数据不合规'}`)
  }
  return result.data
}

/** 草稿 → 完整 Trip 对象（新 id，供预览确认后入库） */
export function draftToTrip(draft: AiDraft, startDate: string, endDate: string, totalBudgetFen = 0) {
  return tripSchema.parse({
    format: 'trip.v1',
    name: draft.name,
    startDate,
    endDate,
    destType: 'generic',
    destCity: draft.destCity,
    totalBudgetFen,
    members: [{ id: 'me0', name: '我', role: 'owner' }],
    days: draft.days,
    expenses: [],
    packing: [],
    notes: '',
    enabledModules: { expenses: true, notes: true },
  })
}
