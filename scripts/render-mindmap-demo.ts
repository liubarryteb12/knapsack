/**
 * 生成一张示例目标思维导图 SVG（用于人工预览，不参与回归）。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/render-mindmap-demo.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { newGoal, newMilestone, newTask, type Goal, type Milestone, type Task } from '../src/mods/mod-goals/schema'
import { buildMindmap } from '../src/mods/mod-goals/services/mindmapTree'
import { layoutMindmap, mindmapToSvg, type Measure } from '../src/mods/mod-goals/services/mindmapLayout'

const measure: Measure = (text, bold, size = 14) => {
  let width = 0
  for (const ch of text) {
    width += /[⺀-鿿＀-￯]/.test(ch) ? size : size * 0.56
  }
  return width * (bold ? 1.05 : 1)
}

const g1 = newGoal({
  title: '跑通公众号矩阵',
  why: '验证内容流水线',
  successCriteria: '连续 8 周每周 3 篇',
  startDate: '2026-11-01',
  targetDate: '2026-12-31',
  priority: 1,
})
const g2 = newGoal({
  title: '接 2 个定制单',
  why: '验证接单与交付流程',
  successCriteria: '2 单按时交付并回款',
  startDate: '2026-11-10',
  targetDate: '2026-12-20',
  priority: 2,
})
const g3 = newGoal({
  title: '建立个人知识库',
  startDate: '2026-11-15',
  priority: 3,
})
g1.status = 'active'
g2.status = 'active'

const m1 = newMilestone({ goalId: g1.id, title: '选题库', acceptance: '沉淀 50 个可写选题', targetDate: '2026-11-15', order: 0 })
const m2 = newMilestone({ goalId: g1.id, title: '发布节奏', acceptance: '每周三更且不断档', order: 1 })
const m3 = newMilestone({ goalId: g2.id, title: '获客渠道', acceptance: '3 个渠道产生咨询', order: 0 })
const m4 = newMilestone({ goalId: g2.id, title: '交付模板', acceptance: '报价单与验收单可复用', order: 1 })
const m5 = newMilestone({ goalId: g3.id, title: '目录结构', acceptance: '4 个一级目录', order: 0 })

const tasks: Task[] = [
  newTask({ milestoneId: m1.id, title: '整理 30 个选题', detail: '含竞品分析', order: 0 }),
  newTask({ milestoneId: m1.id, title: '补 20 个选题', order: 1 }),
  newTask({ milestoneId: m2.id, title: '定下固定发布日', order: 0 }),
  newTask({ milestoneId: m2.id, title: '准备 4 周存稿', estimate: 'L', order: 1 }),
  newTask({ milestoneId: m3.id, title: '列出 10 个潜在客户', order: 0 }),
  newTask({ milestoneId: m4.id, title: '写报价单模板', order: 0 }),
  newTask({ milestoneId: m5.id, title: '画目录草图', order: 0 }),
]
tasks[1]!.status = 'done'
tasks[6]!.status = 'done'

const milestones: Milestone[] = [m1, m2, m3, m4, m5]
const goals: Goal[] = [g1, g2, g3]

const tree = buildMindmap({ goals, milestones, tasks, title: '我的目标' })
const layout = layoutMindmap(tree, measure, { mode: 'both' })
const { svg } = mindmapToSvg(layout, {
  text: '#1f2937',
  sub: '#6b7280',
  card: '#ffffff',
  bg: '#ffffff',
  accent: '#4f46e5',
  dark: false,
  font: 'system-ui, "Microsoft YaHei", sans-serif',
})

const outDir = path.join(process.cwd(), 'reports')
mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'goals-mindmap-demo.svg')
writeFileSync(outFile, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, 'utf8')
console.log(`written ${outFile} (${layout.width}x${layout.height})`)
