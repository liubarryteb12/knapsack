/**
 * 目标思维导图：树构建、Markdown/OPML 导出与布局的纯函数回归。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-mindmap.ts
 */
import {
  newGoal,
  newMilestone,
  newTask,
  type Goal,
  type Milestone,
  type Task,
} from '../src/mods/mod-goals/schema'
import {
  buildMindmap,
  countMindNodes,
  mindmapFilename,
  toMindmapMarkdown,
  toMindmapOpml,
} from '../src/mods/mod-goals/services/mindmapTree'
import {
  edgePath,
  layoutMindmap,
  mindmapToSvg,
  type Measure,
} from '../src/mods/mod-goals/services/mindmapLayout'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

const goalA = newGoal({
  title: '跑通公众号矩阵',
  why: '验证内容流水线',
  successCriteria: '连续 8 周每周 3 篇',
  startDate: '2026-11-01',
  targetDate: '2026-12-31',
  priority: 1,
})
const goalB = newGoal({ title: '接 2 个定制单', startDate: '2026-11-10', priority: 2 })

const mileA1 = newMilestone({
  goalId: goalA.id,
  title: '选题库',
  acceptance: '50 个选题',
  targetDate: '2026-11-15',
  order: 0,
})
const mileA2 = newMilestone({
  goalId: goalA.id,
  title: '发布节奏',
  acceptance: '每周三更',
  order: 1,
})
const taskA1 = newTask({ milestoneId: mileA1.id, title: '整理 30 个选题', detail: '含竞品', order: 0 })
const taskA2 = newTask({ milestoneId: mileA1.id, title: '补 20 个选题', order: 1 })
taskA2.status = 'done'

const goals: Goal[] = [goalA, goalB]
const milestones: Milestone[] = [mileA1, mileA2]
const tasks: Task[] = [taskA1, taskA2]

// ---------- 树构建 ----------

{
  const tree = buildMindmap({ goals, milestones, tasks })
  check('根节点默认标题', tree.text === '我的目标')
  check('根下有 2 个目标', tree.children.length === 2)
  check('目标 A 有 2 个里程碑', tree.children[0]!.children.length === 2)
  check('里程碑按 order 排序', tree.children[0]!.children[0]!.text === '选题库')
  check('任务按 order 排序', tree.children[0]!.children[0]!.children[0]!.text === '整理 30 个选题')
  check('完成的任务勾选', tree.children[0]!.children[0]!.children[1]!.checked === true)
  check('目标备注含状态与优先级', tree.children[0]!.note!.includes('草稿') && tree.children[0]!.note!.includes('P1'))
  check('里程碑备注含验收口径', tree.children[0]!.children[0]!.note!.includes('验收：50 个选题'))
  check('节点总数', countMindNodes(tree) === 2 + 2 + 2)
}

{
  const tree = buildMindmap({ goals, milestones, tasks, selectedGoalIds: new Set([goalB.id]) })
  check('只保留选中的目标', tree.children.length === 1 && tree.children[0]!.id === goalB.id)
}

{
  const tree = buildMindmap({ goals, milestones, tasks, includeTasks: false })
  check('关闭任务层后里程碑无子节点', tree.children[0]!.children[0]!.children.length === 0)
  check('节点总数（不含任务）', countMindNodes(tree) === 4)
}

{
  const tree = buildMindmap({ goals, milestones, tasks, title: '2026 收官' })
  check('自定义根标题', tree.text === '2026 收官')
}

// ---------- Markdown ----------

{
  const md = toMindmapMarkdown(buildMindmap({ goals, milestones, tasks }))
  check('Markdown 有标题', md.startsWith('# 我的目标'))
  check('Markdown 有目标层', md.includes('- 跑通公众号矩阵'))
  check('Markdown 有里程碑层', md.includes('  - 选题库'))
  check('Markdown 有任务层与勾选', md.includes('    - [x] 补 20 个选题'))
  check('Markdown 备注用引用行', md.includes('    > 待开始 · 目标日 2026-11-15 · 验收：50 个选题'))
  check('Markdown 以换行结尾', md.endsWith('\n'))
}

{
  const tree = buildMindmap({ goals: [goalA], milestones: [], tasks: [] })
  tree.children[0]!.text = '[x] 不是勾选框'
  const md = toMindmapMarkdown(tree)
  check('Markdown 行首复选框被转义', md.includes('- \\[x] 不是勾选框'))
}

// ---------- OPML ----------

{
  const opml = toMindmapOpml(buildMindmap({ goals, milestones, tasks }))
  check('OPML 声明与根', opml.includes('<?xml version="1.0" encoding="UTF-8"?>') && opml.includes('<opml version="2.0">'))
  check('OPML text 属性', opml.includes('text="跑通公众号矩阵"'))
  check('OPML _note 属性', opml.includes('_note="草稿 · P1 · 截止 2026-12-31'))
  check('OPML _checked 属性', opml.includes('_checked="true"'))
  check('OPML 结构闭合', opml.trimEnd().endsWith('</opml>'))
}

{
  const tree = buildMindmap({ goals: [goalA], milestones: [], tasks: [] })
  tree.children[0]!.text = 'A&B <C> "D"'
  const opml = toMindmapOpml(tree)
  check('OPML 转义特殊字符', opml.includes('text="A&amp;B &lt;C&gt; &quot;D&quot;"'))
}

// ---------- 布局 ----------

const measure: Measure = (text, bold, size = 14) => text.length * (bold ? 9 : 8) * (size / 14)

{
  const tree = buildMindmap({ goals, milestones, tasks })
  const right = layoutMindmap(tree, measure, { mode: 'right' })
  check('布局节点数等于树节点数', right.nodes.length === countMindNodes(tree) + 1)
  check('布局有尺寸', right.width > 0 && right.height > 0)
  check('向右布局全部在右侧', right.nodes.every((node) => node.side === 1))
  const root = right.byId.get('root')!
  const firstGoal = right.byId.get(goalA.id)!
  check('子节点在父节点右侧', firstGoal.x >= root.x + root.w)
  check('一级分支用锥形连线', right.nodes.some((node) => node.depth === 1 && node.branch >= 0))
  const edge = edgePath(root, firstGoal)
  check('连线路径非空', edge.startsWith('M') && edge.includes('C'))
}

{
  const tree = buildMindmap({ goals, milestones, tasks })
  const both = layoutMindmap(tree, measure, { mode: 'both' })
  check('双向布局存在左侧分支', both.nodes.some((node) => node.side === -1))
  check('双向布局存在右侧分支', both.nodes.some((node) => node.side === 1))
}

{
  const tree = buildMindmap({ goals, milestones, tasks })
  const full = layoutMindmap(tree, measure, { mode: 'right' })
  const collapsed = layoutMindmap(tree, measure, {
    mode: 'right',
    collapsed: new Set([mileA1.id]),
  })
  check('折叠后节点减少', collapsed.nodes.length < full.nodes.length)
  const milestone = collapsed.byId.get(mileA1.id)!
  check('折叠节点标记 collapsed', milestone.collapsed === true)
  check('折叠节点统计隐藏数量', milestone.hidden === 2)
  check('折叠节点不再有可见子节点', milestone.kids.length === 0)
}

{
  const deep = buildMindmap({ goals, milestones, tasks })
  let cursor = deep.children[0]!
  for (let i = 0; i < 300; i++) {
    const child = { id: `deep-${i}`, text: `第 ${i} 层`, children: [] as typeof cursor.children }
    cursor.children.push(child)
    cursor = child
  }
  const layout = layoutMindmap(deep, measure, { mode: 'right' })
  check('深树布局不爆栈', layout.nodes.length === countMindNodes(deep) + 1)
}

// ---------- 单目标聚焦 ----------

{
  // 聚焦模式：目标自身当根，一级分支是里程碑
  const tree = buildMindmap({ goals, milestones, tasks, focusGoalId: goalA.id })
  check('聚焦模式根为目标本身', tree.id === goalA.id && tree.text === '跑通公众号矩阵')
  check('聚焦模式一级分支是里程碑', tree.children.length === 2 && tree.children[0]!.text === '选题库')
  check('聚焦模式任务仍在', tree.children[0]!.children.length === 2)

  const fallback = buildMindmap({ goals, milestones, tasks, focusGoalId: 'no-such-goal' })
  check('未知 focusGoalId 退化为合成模式', fallback.id === 'root' && fallback.text === '我的目标')
}

// ---------- SVG 导出 ----------

{
  const tree = buildMindmap({ goals, milestones, tasks })
  const layout = layoutMindmap(tree, measure, { mode: 'both' })
  const { svg, width, height } = mindmapToSvg(layout, {
    text: '#1f2937',
    sub: '#6b7280',
    card: '#ffffff',
    bg: '#ffffff',
    accent: '#4f46e5',
    dark: false,
    font: 'sans-serif',
  })
  check('SVG 自包含且带命名空间', svg.startsWith('<svg xmlns=') && svg.endsWith('</svg>'))
  check('SVG 不含 CSS 变量', !svg.includes('var('))
  check('SVG 含节点文字', svg.includes('跑通公众号矩阵') && svg.includes('选题库'))
  check('SVG 尺寸含留白', width > layout.width && height > layout.height)
  check('SVG 含勾选标记', svg.includes('stroke-linecap="round"'))
}

// ---------- 子任务层级 ----------

{
  const parent = newTask({ milestoneId: mileA1.id, title: '整理 30 个选题', order: 0 })
  const child = newTask({
    milestoneId: mileA1.id,
    parentId: parent.id,
    title: '翻读者留言',
    order: 0,
  })
  const grand = newTask({
    milestoneId: mileA1.id,
    parentId: child.id,
    title: '给问题打标签',
    order: 0,
  })
  const sibling = newTask({ milestoneId: mileA1.id, title: '刷竞品选题', order: 1 })
  const tree = buildMindmap({
    goals: [goalA],
    milestones: [mileA1],
    tasks: [parent, child, grand, sibling],
  })
  const milestoneNode = tree.children[0]!.children[0]!
  check('一级任务数量正确', milestoneNode.children.length === 2)
  check('子任务挂在父任务下', milestoneNode.children[0]!.children[0]!.text === '翻读者留言')
  check('孙任务挂在子任务下', milestoneNode.children[0]!.children[0]!.children[0]!.text === '给问题打标签')
  check('同级任务不受影响', milestoneNode.children[1]!.text === '刷竞品选题')

  const md = toMindmapMarkdown(tree)
  check('Markdown 缩进反映 4 层结构', md.includes('        - [ ] 给问题打标签'))
  const opml = toMindmapOpml(tree)
  check('OPML 嵌套反映层级', opml.includes('给问题打标签'))

  const orphan = newTask({
    milestoneId: mileA1.id,
    parentId: 'no-such-parent',
    title: '孤儿任务',
    order: 2,
  })
  const orphanTree = buildMindmap({ goals: [goalA], milestones: [mileA1], tasks: [parent, orphan] })
  check('找不到父任务的任务不显示', orphanTree.children[0]!.children[0]!.children.length === 1)

  const loopA = newTask({ milestoneId: mileA1.id, title: 'A', order: 0 })
  const loopB = newTask({ milestoneId: mileA1.id, title: 'B', order: 0 })
  loopA.parentId = loopB.id
  loopB.parentId = loopA.id
  const loopTree = buildMindmap({ goals: [goalA], milestones: [mileA1], tasks: [loopA, loopB] })
  check('parentId 成环不会死循环', loopTree.children[0]!.children[0]!.children.length === 0)
}

// ---------- 文件名 ----------

check(
  '文件名带日期与扩展名',
  mindmapFilename('md', new Date(2026, 10, 21)) === 'knapsack-mindmap-20261121.md',
)

console.log(`\nmindmap tests: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`)
if (failed > 0) process.exit(1)
