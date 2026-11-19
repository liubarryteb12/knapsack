import { z } from 'zod'
import type { AiConfig } from '../../../utils/aiConfig'
import { loadAiConfigWithKey } from '../../../utils/aiConfig'
import { dispatchDraftSchema, validateDispatch, type BoardRole, type DispatchDraft, type Task } from '../schema'
import { buildDispatchPrompt, type DispatchSnapshot } from './dispatchPrompts'

export class ModeratorError extends Error {}

const WORK_PROMPT_CATALOG_TOPIC = 'capability:work-prompt-catalog' as const

interface WorkPromptProjectionLite {
  id: string
  title: string
  systemRole: string
}

function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || '根'}：${issue.message}`)
    .join('；')
}

function extractJson(text: string): unknown {
  let raw = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  if (fence?.[1]) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new ModeratorError('返回内容里找不到 JSON 对象')
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch (error) {
    throw new ModeratorError(`返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function callChat(config: AiConfig, prompt: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  try {
    const resp = await fetch(`${config.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new ModeratorError(`接口返回 ${resp.status}${body ? `：${body.slice(0, 200)}` : ''}`)
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new ModeratorError('接口返回里没有内容')
    return content
  } catch (error) {
    if (signal?.aborted) throw new ModeratorError('已取消')
    if (error instanceof ModeratorError) throw error
    throw new ModeratorError('网络不通或请求超时')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

function personaSummaryOf(role: BoardRole, catalog: WorkPromptProjectionLite[]): string {
  if (!role.promptId) return ''
  const item = catalog.find((row) => row.id === role.promptId)
  return item?.systemRole.slice(0, 120) ?? ''
}

/** 组装看板快照（只含 todo/doing），构建提示词，调用模型并校验草案 */
export async function runModerator(
  input: {
    goals: DispatchSnapshot['goals']
    roles: BoardRole[]
    tasks: Task[]
    taskTitleOf: (taskId: string) => string
    goalTitleOf: (milestoneId: string) => string
    milestoneTitleOf: (milestoneId: string) => string
    doingCountByRole: Record<string, number>
    manualRoleByTask: Record<string, string>
    moderatorPromptId?: string
    catalogProvider?: () => Promise<WorkPromptProjectionLite[]>
  },
  signal?: AbortSignal,
): Promise<{ draft: DispatchDraft; dropped: Array<{ index: number; reason: string }>; conflicts: string[]; prompt: string }> {
  const config = await loadAiConfigWithKey()
  if (!config.apiKey) throw new ModeratorError('未配置 API Key')

  const catalog = input.catalogProvider ? await input.catalogProvider().catch(() => []) : []

  const snapshot: DispatchSnapshot = {
    goals: input.goals,
    roles: input.roles.map((role) => ({
      id: role.id,
      name: role.name,
      tier: role.tier,
      charter: role.charter,
      personaSummary: personaSummaryOf(role, catalog),
      maxDoing: role.maxDoing,
      doingCount: input.doingCountByRole[role.id] ?? 0,
    })),
    tasks: input.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      detail: task.detail,
      goalTitle: input.goalTitleOf(task.milestoneId),
      milestoneTitle: input.milestoneTitleOf(task.milestoneId),
      estimate: task.estimate,
      dueDate: task.dueDate,
      status: task.status === 'doing' ? 'doing' : 'todo',
      roleId: task.roleId,
    })),
  }

  let basePrompt = buildDispatchPrompt(snapshot)
  const moderatorItem = input.moderatorPromptId
    ? catalog.find((row) => row.id === input.moderatorPromptId)
    : undefined
  if (moderatorItem) {
    basePrompt = [
      '## 主理人工作方式（来自提示词库，只影响风格，不影响输出契约与硬性约束）',
      moderatorItem.systemRole || moderatorItem.title,
      '',
      basePrompt,
    ].join('\n')
  }

  const first = await callChat(config, basePrompt, signal)
  const parsed = dispatchDraftSchema.safeParse(extractJson(first))
  if (parsed.success) {
    const result = validateDispatch(parsed.data, {
      taskIds: new Set(snapshot.tasks.map((t) => t.id)),
      roles: snapshot.roles,
      doingCountByRole: input.doingCountByRole,
      manualRoleByTask: input.manualRoleByTask,
    })
    return { draft: result.clean, dropped: result.dropped, conflicts: result.conflicts, prompt: basePrompt }
  }

  // 回喂错误重试 1 次
  const retryPrompt = [
    basePrompt,
    '',
    '## 上一次输出的问题',
    `你上次的输出未通过校验：${issuesText(parsed.error)}`,
    '请严格按输出格式重新只输出一个合法 JSON 对象。',
  ].join('\n')
  const second = await callChat(config, retryPrompt, signal)
  const secondParsed = dispatchDraftSchema.safeParse(extractJson(second))
  if (!secondParsed.success) {
    throw new ModeratorError(`主理人两次输出均不合规：${issuesText(secondParsed.error)}`)
  }
  const result = validateDispatch(secondParsed.data, {
    taskIds: new Set(snapshot.tasks.map((t) => t.id)),
    roles: snapshot.roles,
    doingCountByRole: input.doingCountByRole,
    manualRoleByTask: input.manualRoleByTask,
  })
  return { draft: result.clean, dropped: result.dropped, conflicts: result.conflicts, prompt: basePrompt }
}

export { WORK_PROMPT_CATALOG_TOPIC }
