/**
 * 目标 → 思维导图树（纯函数）。
 *
 * 树的形状固定为「根 → 目标 → 里程碑 → 任务」，与 dsh-mindmap 的
 * OutlineDoc/TreeItem 同构：Markdown（嵌套 `- ` 列表 + `> ` 备注）与
 * OPML 2.0（`text` / `_note` / `_checked`）都能被 dsh-mindmap 直接导入。
 *
 * 本文件不碰 UI 与 IndexedDB，供组件与 Node 测试共用。
 */
import type { Goal, Milestone, Task } from '../schema'

export interface MindNode {
  id: string
  text: string
  /** 多行备注：状态、日期、验收口径、任务详情 */
  note?: string
  /** 勾选态；undefined = 普通节点 */
  checked?: boolean
  children: MindNode[]
}

export interface BuildMindmapInput {
  goals: readonly Goal[]
  milestones: readonly Milestone[]
  tasks: readonly Task[]
  /** 只保留这些目标；缺省 = 全部 */
  selectedGoalIds?: ReadonlySet<string>
  /**
   * 单目标聚焦：该目标自身作为导图根节点，里程碑挂在其下。
   * 未找到时退化为多目标合成（根节点用 title）。
   */
  focusGoalId?: string
  /** 多目标模式下根节点文字 */
  title?: string
  /** 是否展开任务层，默认 true */
  includeTasks?: boolean
}

const GOAL_STATUS_LABEL: Record<Goal['status'], string> = {
  draft: '草稿',
  active: '进行中',
  paused: '暂停',
  done: '已完成',
  abandoned: '已放弃',
}

const MILESTONE_STATUS_LABEL: Record<Milestone['status'], string> = {
  todo: '待开始',
  active: '进行中',
  done: '已完成',
  missed: '已错过',
}

const TASK_STATUS_LABEL: Record<Task['status'], string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  dropped: '已放弃',
}

function joinMeta(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' · ')
}

function goalNote(goal: Goal): string {
  const head = joinMeta([
    GOAL_STATUS_LABEL[goal.status],
    `P${goal.priority}`,
    goal.targetDate ? `截止 ${goal.targetDate}` : undefined,
  ])
  const lines = [head]
  if (goal.why.trim()) lines.push(`为什么：${goal.why.trim()}`)
  if (goal.successCriteria.trim()) lines.push(`成功标准：${goal.successCriteria.trim()}`)
  return lines.join('\n')
}

function milestoneNote(milestone: Milestone): string {
  return joinMeta([
    MILESTONE_STATUS_LABEL[milestone.status],
    milestone.targetDate ? `目标日 ${milestone.targetDate}` : undefined,
    `验收：${milestone.acceptance.trim()}`,
  ])
}

function taskNote(task: Task): string {
  const lines = [
    joinMeta([
      TASK_STATUS_LABEL[task.status],
      task.dueDate ? `截止 ${task.dueDate}` : undefined,
      `工作量 ${task.estimate}`,
    ]),
  ]
  if (task.detail.trim()) lines.push(task.detail.trim())
  return lines.join('\n')
}

/** 由本地目标数据构建思维导图树。顺序沿用传入顺序（调用方传 goalsSorted）。 */
export function buildMindmap(input: BuildMindmapInput): MindNode {
  const includeTasks = input.includeTasks ?? true
  const milestonesByGoal = new Map<string, Milestone[]>()
  for (const milestone of input.milestones) {
    const list = milestonesByGoal.get(milestone.goalId)
    if (list) list.push(milestone)
    else milestonesByGoal.set(milestone.goalId, [milestone])
  }
  for (const list of milestonesByGoal.values()) list.sort((a, b) => a.order - b.order)

  // 任务按「里程碑 + 父任务」分组：parentId 缺省即里程碑下的一级任务
  const tasksByParent = new Map<string, Task[]>()
  const parentKey = (milestoneId: string, parentId?: string): string =>
    `${milestoneId}|${parentId ?? ''}`
  for (const task of input.tasks) {
    const key = parentKey(task.milestoneId, task.parentId)
    const list = tasksByParent.get(key)
    if (list) list.push(task)
    else tasksByParent.set(key, [task])
  }
  for (const list of tasksByParent.values()) list.sort((a, b) => a.order - b.order)

  const goals = input.goals.filter(
    (goal) => input.selectedGoalIds === undefined || input.selectedGoalIds.has(goal.id),
  )

  // 任务子树：任一节点最多出现一次，parentId 成环时断开，避免死循环
  const visited = new Set<string>()
  const taskNodes = (milestoneId: string, parentId?: string): MindNode[] =>
    (tasksByParent.get(parentKey(milestoneId, parentId)) ?? [])
      .filter((task) => !visited.has(task.id))
      .map<MindNode>((task) => {
        visited.add(task.id)
        return {
          id: task.id,
          text: task.title,
          note: taskNote(task),
          checked: task.status === 'done',
          children: includeTasks ? taskNodes(milestoneId, task.id) : [],
        }
      })

  const milestoneNodes = (goalId: string): MindNode[] =>
    (milestonesByGoal.get(goalId) ?? []).map<MindNode>((milestone) => {
      const tasks = includeTasks ? taskNodes(milestone.id) : []
      return {
        id: milestone.id,
        text: milestone.title,
        note: milestoneNote(milestone),
        // 只给已完成项打勾，未完成不画空复选框，保持导图干净
        checked: milestone.status === 'done' ? true : undefined,
        children: tasks,
      }
    })

  // 单目标聚焦：目标自身当根，一级分支就是里程碑
  const focus = input.focusGoalId ? goals.find((goal) => goal.id === input.focusGoalId) : undefined
  if (focus) {
    return {
      id: focus.id,
      text: focus.title,
      note: goalNote(focus),
      checked: focus.status === 'done' ? true : undefined,
      children: milestoneNodes(focus.id),
    }
  }

  const goalNodes: MindNode[] = goals.map((goal) => ({
    id: goal.id,
    text: goal.title,
    note: goalNote(goal),
    checked: goal.status === 'done' ? true : undefined,
    children: milestoneNodes(goal.id),
  }))

  return {
    id: 'root',
    text: input.title?.trim() || '我的目标',
    children: goalNodes,
  }
}

function escapeMarkdownText(text: string): string {
  const oneLine = text.replace(/[\r\n]+/g, ' ').trim()
  // 与 dsh-mindmap 的解析器约定一致：行首复选框要转义，否则会被当成勾选态
  return /^\[( |x|X)\]/.test(oneLine) ? `\\${oneLine}` : oneLine
}

/** 导出为 dsh-mindmap 可导入的 Markdown（嵌套列表 + 引用备注 + 勾选框）。 */
export function toMindmapMarkdown(tree: MindNode): string {
  const lines: string[] = [`# ${escapeMarkdownText(tree.text)}`, '']
  const stack: Array<{ node: MindNode; depth: number }> = []
  for (let i = tree.children.length - 1; i >= 0; i--) {
    stack.push({ node: tree.children[i]!, depth: 0 })
  }
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    const pad = '  '.repeat(depth)
    const box = node.checked === true ? '[x] ' : node.checked === false ? '[ ] ' : ''
    lines.push(`${pad}- ${box}${escapeMarkdownText(node.text)}`)
    if (node.note) {
      for (const line of node.note.split('\n')) {
        lines.push(line.trim() ? `${pad}  > ${line.trim()}` : `${pad}  >`)
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, depth: depth + 1 })
    }
  }
  return lines.join('\n') + '\n'
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '')
}

/** 导出为 OPML 2.0（dsh-mindmap 支持的另一种导入格式）。 */
export function toMindmapOpml(tree: MindNode): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${escapeXml(tree.text)}</title></head>`,
    '  <body>',
  ]
  const walk = (nodes: readonly MindNode[], depth: number): void => {
    for (const node of nodes) {
      const pad = '  '.repeat(depth + 2)
      const attrs = [
        `text="${escapeXml(node.text)}"`,
        node.note ? `_note="${escapeXml(node.note)}"` : '',
        typeof node.checked === 'boolean' ? `_checked="${node.checked}"` : '',
      ]
        .filter(Boolean)
        .join(' ')
      if (node.children.length === 0) out.push(`${pad}<outline ${attrs}/>`)
      else {
        out.push(`${pad}<outline ${attrs}>`)
        walk(node.children, depth + 1)
        out.push(`${pad}</outline>`)
      }
    }
  }
  walk(tree.children, 0)
  out.push('  </body>', '</opml>')
  return out.join('\n') + '\n'
}

/** 导图节点总数（不含根）。 */
export function countMindNodes(tree: MindNode): number {
  let count = 0
  const stack = [...tree.children]
  while (stack.length > 0) {
    const node = stack.pop()!
    count++
    for (const child of node.children) stack.push(child)
  }
  return count
}

/** 导出文件名：knapsack-mindmap-YYYYMMDD.ext */
export function mindmapFilename(ext: string, now = new Date()): string {
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  return `knapsack-mindmap-${ymd}.${ext.replace(/^\./, '')}`
}
