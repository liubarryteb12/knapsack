import { todayStr } from '../../../utils/date'
import { DATA_NOTE_FALLBACK } from '../prompts'

/** 主理人分派提示词版本 */
export const DISPATCH_PROMPT_VERSION = 1

export interface DispatchSnapshot {
  goals: Array<{ id: string; title: string; priority: 1 | 2 | 3 }>
  roles: Array<{
    id: string
    name: string
    tier: 'lead' | 'specialist' | 'helper'
    charter: string
    personaSummary: string
    maxDoing: number
    doingCount: number
  }>
  tasks: Array<{
    id: string
    title: string
    detail: string
    goalTitle: string
    milestoneTitle: string
    estimate: 'S' | 'M' | 'L'
    dueDate?: string
    status: 'todo' | 'doing'
    roleId?: string
  }>
}

const TIER_LABEL: Record<DispatchSnapshot['roles'][number]['tier'], string> = {
  lead: '主责',
  specialist: '专职',
  helper: '辅助',
}

/** 用户素材声明：与 goals/prompts.ts 同一口径 */
const DATA_NOTE = DATA_NOTE_FALLBACK

function personaBlock(role: DispatchSnapshot['roles'][number]): string {
  const lines = [
    `- id: ${role.id}`,
    `  名称: ${role.name}`,
    `  层级: ${TIER_LABEL[role.tier]}`,
    `  职责: ${role.charter || '（未填写）'}`,
  ]
  if (role.personaSummary) {
    lines.push(`  人格摘要: ${role.personaSummary}`)
  }
  lines.push(`  容量: 进行中 ${role.doingCount}/${role.maxDoing}`)
  return lines.join('\n')
}

function taskBlock(task: DispatchSnapshot['tasks'][number]): string {
  const lines = [
    `- id: ${task.id}`,
    `  标题: ${task.title}`,
    `  目标: ${task.goalTitle} / 里程碑: ${task.milestoneTitle}`,
    `  状态: ${task.status === 'doing' ? '进行中' : '待办'}`,
    `  体量: ${task.estimate}`,
  ]
  if (task.detail) lines.push(`  详情: ${task.detail.slice(0, 200)}`)
  if (task.dueDate) lines.push(`  截止: ${task.dueDate}`)
  if (task.roleId) lines.push(`  当前人格: ${task.roleId}（手动指定，除非用户允许否则不要改派）`)
  return lines.join('\n')
}

export function buildDispatchPrompt(snapshot: DispatchSnapshot, today = todayStr()): string {
  const roles = snapshot.roles.length > 0 ? snapshot.roles.map(personaBlock).join('\n') : '（当前没有人格，全部任务放 unassigned）'
  const tasks = snapshot.tasks.length > 0 ? snapshot.tasks.map(taskBlock).join('\n') : '（看板上没有待处理任务）'
  const goals = snapshot.goals.map((g) => `- ${g.title}（P${g.priority}）`).join('\n') || '（无）'

  return [
    '## 任务',
    '你是看板主理人。把「任务特征」匹配到「人格」，产出一份分派草案。',
    '你是顾问，不是执行者：只建议，不新增、不修改、不删除任何任务或人格。',
    '',
    '## 匹配方法',
    '1. 提取每个任务的特征：动作类型（检索/写作/设计/审阅/执行）、产出物、领域、体量。',
    '2. 对照人格的名称、层级、职责、人格摘要，选出最合适的一个。',
    '3. 每条建议必须让用户一眼能判断对错：traits 写任务特征短标签，reason 讲「任务特征 → 人格职责」的对应关系。',
    '',
    '## 输出格式',
    '只输出一个 JSON 对象：',
    '{ "assignments": [ { "taskId": "…", "roleId": "…", "priority": 1, "traits": ["检索"], "reason": "…" } ], "unassigned": [ { "taskId": "…", "reason": "…" } ], "notes": "…" }',
    '',
    '## 硬性约束',
    '1. taskId 只能来自输入任务；roleId 只能来自输入人格。禁止编造 ID。',
    '2. 不得新增、删除或改写任务与人格。',
    '3. 每个任务最多出现一次（assignments 或 unassigned 二选一）。',
    '4. 每个人格名下的建议数不得超过其剩余容量（maxDoing - doingCount）；装不下就放 unassigned。',
    '5. 标注「手动指定」的任务，除非用户在指令中明确允许改派，否则跳过。',
    '6. 每条建议 1-3 个 traits，只能从任务标题/详情提炼；reason ≤ 40 字。',
    '7. notes ≤ 200 字，写整体推进思路。',
    '8. 判断不了的任务放 unassigned 并说明原因，不要硬塞。',
    '9. 只输出 JSON，禁止解释文字和 Markdown 代码块标记。',
    '',
    '## 素材',
    `今天的日期是 ${today}。`,
    DATA_NOTE,
    '<goals>',
    goals,
    '</goals>',
    '<roles>',
    roles,
    '</roles>',
    '<tasks>',
    tasks,
    '</tasks>',
  ].join('\n')
}
