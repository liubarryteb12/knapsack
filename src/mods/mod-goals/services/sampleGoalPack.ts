/**
 * 示例目标包（goal-pack.v1 结构）。
 *
 * 供导图栏目「载入示例目标」使用：用户确认后走既有导入管线写库，
 * 内容与 skills/knapsack-goal 的拆解口径一致（目标 → 里程碑 → 任务）。
 */
import { toDateStr } from '../../../utils/date'
import { goalPackSchema, type GoalPack } from '../schema'
import { buildImportPlan, commitImport, loadLocalSnapshot, type ImportPlan } from './parseGoalPack'

function dayOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateStr(date)
}

/** 三个结构完整、可直接看导图的示例目标。 */
export function sampleGoalPack(): GoalPack {
  const start = dayOffset(0)
  return {
    format: 'goal-pack.v1',
    schemaVersion: 1,
    source: 'manual',
    createdAt: new Date().toISOString(),
    assumptions: ['示例数据：结构完整、可直接删除，用于体验思维导图与层级任务'],
    ideas: [],
    goals: [
      {
        externalId: 'sample-content-matrix',
        title: '跑通公众号矩阵',
        why: '验证内容流水线能不能稳定产出',
        successCriteria: '连续 8 周每周 3 篇，且至少 2 篇进入平台推荐',
        horizon: 'quarter',
        startDate: start,
        targetDate: dayOffset(60),
        status: 'active',
        priority: 1,
        source: 'manual',
        milestones: [
          {
            externalId: 'sample-matrix-topic-pool',
            title: '选题库落地',
            acceptance: '沉淀 50 个可写选题，每个带一句话角度',
            targetDate: dayOffset(7),
            status: 'active',
            order: 0,
            tasks: [
              {
                externalId: 'sample-matrix-collect-30',
                title: '整理 30 个选题',
                detail: '从近半年热点与竞品目录里挑，标注可复用角度',
                estimate: 'M',
                dueDate: dayOffset(3),
                status: 'doing',
                order: 0,
              },
              {
                externalId: 'sample-matrix-collect-20',
                title: '补 20 个选题',
                detail: '优先补齐三条主线各 5 个',
                estimate: 'S',
                dueDate: dayOffset(6),
                status: 'todo',
                order: 1,
              },
            ],
          },
          {
            externalId: 'sample-matrix-rhythm',
            title: '发布节奏跑稳',
            acceptance: '连续 4 周不断档，存稿始终领先一周',
            targetDate: dayOffset(30),
            status: 'todo',
            order: 1,
            tasks: [
              {
                externalId: 'sample-matrix-fixed-day',
                title: '定下固定发布日',
                detail: '选两个不加班的工作日晚上',
                estimate: 'S',
                dueDate: dayOffset(2),
                status: 'todo',
                order: 0,
              },
              {
                externalId: 'sample-matrix-buffer',
                title: '准备 4 周存稿',
                detail: '每周 3 篇，先堆满再开始发',
                estimate: 'L',
                dueDate: dayOffset(21),
                status: 'todo',
                order: 1,
              },
            ],
          },
          {
            externalId: 'sample-matrix-review',
            title: '数据回看成型',
            acceptance: '每周一次数据复盘，能说清哪篇为什么行',
            targetDate: dayOffset(45),
            status: 'todo',
            order: 2,
            tasks: [
              {
                externalId: 'sample-matrix-dashboard',
                title: '搭一张数据总表',
                detail: '阅读、涨粉、转发三列，按周录入',
                estimate: 'M',
                dueDate: dayOffset(14),
                status: 'todo',
                order: 0,
              },
            ],
          },
        ],
      },
      {
        externalId: 'sample-custom-order',
        title: '接 2 个定制单',
        why: '验证从获客到交付回款的完整链路',
        successCriteria: '2 单按时交付并回款，单个不低于 2000',
        horizon: 'quarter',
        startDate: start,
        targetDate: dayOffset(50),
        status: 'active',
        priority: 2,
        source: 'manual',
        milestones: [
          {
            externalId: 'sample-order-channel',
            title: '获客渠道打通',
            acceptance: '3 个渠道产生有效咨询',
            targetDate: dayOffset(14),
            status: 'todo',
            order: 0,
            tasks: [
              {
                externalId: 'sample-order-leads',
                title: '列出 10 个潜在客户',
                detail: '从社群、前同事、公开需求里各找几个',
                estimate: 'M',
                dueDate: dayOffset(5),
                status: 'todo',
                order: 0,
              },
              {
                externalId: 'sample-order-profile',
                title: '写一页接单介绍',
                detail: '能做什么、交付周期、报价区间',
                estimate: 'S',
                dueDate: dayOffset(7),
                status: 'todo',
                order: 1,
              },
            ],
          },
          {
            externalId: 'sample-order-delivery',
            title: '交付模板可复用',
            acceptance: '报价单、进度表、验收单三件套能直接用',
            targetDate: dayOffset(30),
            status: 'todo',
            order: 1,
            tasks: [
              {
                externalId: 'sample-order-quote',
                title: '写报价单模板',
                detail: '分档位，留预算弹性',
                estimate: 'S',
                dueDate: dayOffset(10),
                status: 'todo',
                order: 0,
              },
              {
                externalId: 'sample-order-accept',
                title: '写验收单模板',
                detail: '把交付物和验收口径写死，避免扯皮',
                estimate: 'S',
                dueDate: dayOffset(12),
                status: 'todo',
                order: 1,
              },
            ],
          },
        ],
      },
      {
        externalId: 'sample-knowledge-base',
        title: '建立个人知识库',
        why: '把散落的经验和素材沉淀成可检索的结构',
        successCriteria: '4 个一级目录，且每个目录有 10 条以上有效内容',
        horizon: 'half-year',
        startDate: start,
        targetDate: dayOffset(90),
        status: 'draft',
        priority: 3,
        source: 'manual',
        milestones: [
          {
            externalId: 'sample-kb-structure',
            title: '目录结构定稿',
            acceptance: '4 个一级目录，命名和边界都不重叠',
            targetDate: dayOffset(10),
            status: 'todo',
            order: 0,
            tasks: [
              {
                externalId: 'sample-kb-sketch',
                title: '画目录草图',
                detail: '按「输入 / 产出 / 方法论 / 素材」四块切',
                estimate: 'S',
                dueDate: dayOffset(4),
                status: 'todo',
                order: 0,
              },
              {
                externalId: 'sample-kb-migrate',
                title: '迁移现有笔记',
                detail: '先把最近三个月的搬进去',
                estimate: 'M',
                dueDate: dayOffset(9),
                status: 'todo',
                order: 1,
              },
            ],
          },
          {
            externalId: 'sample-kb-habit',
            title: '入库习惯养成',
            acceptance: '连续 3 周每周至少 5 次入库',
            targetDate: dayOffset(40),
            status: 'todo',
            order: 1,
            tasks: [
              {
                externalId: 'sample-kb-inbox',
                title: '建一个收件箱入口',
                detail: '手机和电脑都能一键丢进去',
                estimate: 'S',
                dueDate: dayOffset(12),
                status: 'todo',
                order: 0,
              },
            ],
          },
        ],
      },
    ],
    cycles: [],
  }
}

/**
 * 载入示例目标：走既有导入管线（校验 → 计划 → 事务写入），
 * 已存在的示例按 externalId 更新而不是重复创建。
 */
export async function loadSampleGoals(): Promise<ImportPlan> {
  const pack = goalPackSchema.parse(sampleGoalPack())
  const local = await loadLocalSnapshot()
  const plan = await buildImportPlan(pack, local)
  await commitImport(plan)
  return plan
}
