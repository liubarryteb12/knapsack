/**
 * 团队领域 schema（team.v1）
 *
 * 与私人 trip.v1 完全独立；不用 z.object.strip 的方式兼容旧 Trip。
 * 设计约束来自 SPEC：
 * - memberId 是主机绑定身份，不信客户端自报；
 * - Submission 带 revision，旧确认不自动被新修订覆盖；
 * - Expense 的作者与 payerId 分离，expenseReportId 是费用来源唯一键；
 * - Publication 不可变，version 单调递增。
 */
import { z } from 'zod'
import { TEAM_FORMAT, TEAM_PUBLICATION_FORMAT } from './protocol'

/** 阶段枚举（本文件本地定义） */
export const stageSchema = z.enum(['purchase', 'carry', 'count'])

// ---------- 基础 ----------

export const idSchema = z.string().min(1)

/** 数量：整数最小单位（如 ml），可 0 */
export const qtySchema = z.number().int().min(0)

// ---------- 名册 ----------

/** 成员在团队中的角色；主机组织者才有确认/发布权限（服务端校验，客户端仅展示） */
export const teamRoleSchema = z.enum(['organizer', 'member'])

export const teamMemberSchema = z.object({
  /** 主机绑定的稳定 memberId */
  memberId: idSchema,
  name: z.string().min(1, '成员名不能为空'),
  role: teamRoleSchema,
  /** 加入时间（epoch ms）；恢复配对不改变 memberId */
  joinedAt: z.number().int().min(0),
})

// ---------- 物资与批次 ----------

/** 一项公共物资需求 */
export const teamItemSchema = z.object({
  itemId: idSchema,
  name: z.string().min(1, '物资名不能为空'),
  category: z.enum(['food', 'equip', 'medicine', 'doc', 'other']),
  /** 需求数量（整数最小单位） */
  qtyNeeded: qtySchema,
  /** 单位（如 ml/瓶/个）；同需求同单位，不自动换算 */
  unit: z.string().min(1),
  note: z.string().default(''),
})

/** 一个 allocation 批次 = 同一批实物；买/带/清点围绕它展开 */
export const teamAllocationSchema = z.object({
  allocationId: idSchema,
  itemId: idSchema,
  /** 计划数量（整数最小单位） */
  qtyPlanned: qtySchema,
  /** 采购负责人 memberId；至多一名，多人拆批次（SPEC 3.3） */
  purchaseBy: idSchema.nullable(),
  /** 携带负责人 memberId；至多一名 */
  carryBy: idSchema.nullable(),
  note: z.string().default(''),
})

// ---------- 汇总节点 ----------

export const checkpointStatusSchema = z.enum(['draft', 'open', 'closed'])

export const teamCheckpointSchema = z.object({
  checkpointId: idSchema,
  name: z.string().min(1, '节点名不能为空'),
  /** 清点负责人（可提交清点报告） */
  counterBy: idSchema.nullable(),
  status: checkpointStatusSchema,
  note: z.string().default(''),
})

// ---------- 报告 ----------

/** 上传状态与业务审核状态是两个维度（SPEC 3.4） */
export const uploadStateSchema = z.enum(['draft', 'pending', 'accepted', 'failed'])
export const reviewStateSchema = z.enum(['submitted', 'confirmed', 'rejected', 'stale', 'withdrawn'])

/** 一条成员报告（费用或数量）；stale 由任务版本变化时主机计算 */
export const submissionSchema = z.object({
  submissionId: idSchema,
  revision: z.number().int().min(1),
  teamId: idSchema,
  /** 作者由主机凭证推导，不采信请求体里的 authorId；此字段由主机填入 */
  authorMemberId: idSchema,
  allocationId: idSchema.nullable(),
  /** 费用报告可无批次 */
  stage: stageSchema,
  /** purchase/carry 恒为 null；count 必须有 */
  checkpointId: z.string().nullable(),
  /** 报告依据的任务版本，任务变更后旧版本进 stale */
  taskRevision: z.number().int().min(1),
  /** 数量报告时填写 */
  qty: qtySchema.nullable(),
  /** 费用报告时填写；整数分 */
  amountFen: z.number().int().min(0).nullable(),
  /** 费用来源唯一键（作者维度稳定）；其他成员不能复用它修订 */
  expenseReportId: idSchema.nullable(),
  /** 实际付款人可与作者不同，主机确认后才入账（SPEC 3.5） */
  payerMemberId: idSchema.nullable(),
  /** 一笔费用可关联多批次，只追踪不重复计额 */
  relatedAllocationIds: z.array(idSchema).default([]),
  note: z.string().default(''),
  uploadedAt: z.number().int().nullable(),
  review: reviewStateSchema,
  reviewNote: z.string().default(''),
  /** 主机确认/退回时间 */
  reviewedAt: z.number().int().nullable(),
})

// ---------- 正式费用（主机确认后入团队账本） ----------

export const teamExpenseSchema = z.object({
  /** 等于来源报告的 expenseReportId，保证一笔费用一个来源 */
  expenseReportId: idSchema,
  teamId: idSchema,
  /** 报告作者（费用归属人） */
  authorMemberId: idSchema,
  /** 实际垫付人 */
  payerMemberId: idSchema,
  amountFen: z.number().int().min(0),
  /** 分摊：成员 memberId → 整数分；总和等于 amountFen 由领域函数校验 */
  shares: z.record(idSchema, z.number().int().min(0)),
  /** 关联批次，仅追踪 */
  relatedAllocationIds: z.array(idSchema).default([]),
  title: z.string().min(1),
  category: z.enum(['food', 'equip', 'medicine', 'doc', 'other']),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.number().int().min(0),
  /** 修订链：来源 submissionId+revision */
  sourceSubmissionId: idSchema,
  sourceRevision: z.number().int().min(1),
})

// ---------- 发布 ----------

/** 公共快照白名单投影（SPEC 4.1）——不含私人 Trip 内容、凭证、草稿 */
export const publicSnapshotSchema = z.object({
  format: z.literal(TEAM_PUBLICATION_FORMAT),
  teamId: idSchema,
  publicationId: idSchema,
  version: z.number().int().min(1),
  /** 发布依据的草稿版本 */
  sourceDraftRevision: z.number().int().min(1),
  createdAt: z.number().int().min(0),
  /** 内容摘要（规范化 JSON 的 sha-256 hex），用于幂等与冲突判断 */
  digest: z.string().min(1),
  /** 公共名册 */
  roster: z.array(
    z.object({
      memberId: idSchema,
      name: z.string(),
      role: teamRoleSchema,
    }),
  ),
  /** 公共行程（可选，主机创建团队时选择的公共日程字段） */
  itinerary: z
    .object({
      title: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      days: z.array(
        z.object({
          date: z.string(),
          items: z.array(
            z.object({
              time: z.string().nullable(),
              type: z.enum(['transport', 'stay', 'food', 'play', 'other']),
              title: z.string(),
              note: z.string().default(''),
            }),
          ),
        }),
      ),
    })
    .nullable(),
  /** 物资需求 + 批次 + 节点 + 确认结果/缺口 */
  items: z.array(
    z.object({
      itemId: idSchema,
      name: z.string(),
      category: z.string(),
      qtyNeeded: qtySchema,
      unit: z.string(),
      note: z.string(),
      allocations: z.array(
        z.object({
          allocationId: idSchema,
          qtyPlanned: qtySchema,
          purchaseBy: idSchema.nullable(),
          carryBy: idSchema.nullable(),
          /** 该批次当前确认量（按阶段分列），来自主机已确认 submission */
          confirmed: z.array(
            z.object({
              stage: stageSchema,
              checkpointId: z.string().nullable(),
              qty: qtySchema,
              /** 来源 submissionId+revision；无确认时为 null */
              submissionId: idSchema.nullable(),
              revision: z.number().int().nullable(),
            }),
          ),
          /** 未清点完整时主机计算并填入；缺口 = max(0, 需求 - 已确认清点量) */
          gap: z.number().int().min(0).nullable(),
          /** 「未清点完整」标记，不伪装成确定缺失（SPEC 3.3） */
          uncounted: z.boolean(),
        }),
      ),
    }),
  ),
  checkpoints: z.array(
    z.object({
      checkpointId: idSchema,
      name: z.string(),
      status: checkpointStatusSchema,
    }),
  ),
  /** 已确认公共费用与分摊 */
  expenses: z.array(
    z.object({
      expenseReportId: idSchema,
      title: z.string(),
      category: z.string(),
      amountFen: z.number().int().min(0),
      payerMemberId: idSchema,
      authorMemberId: idSchema,
      shares: z.record(idSchema, z.number().int().min(0)),
      spentOn: z.string(),
    }),
  ),
  /** 成员可见的任务状态（我的任务派生来源） */
  assignments: z.array(
    z.object({
      memberId: idSchema,
      allocationId: idSchema,
      /** 该成员在此批次承担的环节 */
      stages: z.array(stageSchema),
    }),
  ),
})

export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>

/** 发布元数据（成员端与主机端都保留） */
export const publicationMetaSchema = z.object({
  teamId: idSchema,
  publicationId: idSchema,
  version: z.number().int().min(1),
  createdAt: z.number().int().min(0),
  digest: z.string(),
  sourceDraftRevision: z.number().int().min(1),
})

// ---------- 加入申请（主机侧待审批） ----------

export const joinStatusSchema = z.enum(['pending', 'approved', 'rejected'])

export const pendingJoinSchema = z.object({
  joinRequestId: idSchema,
  /** 成员设备配对标识；恢复配对时主机核对，避免重复名册 */
  deviceId: idSchema,
  memberName: z.string().min(1),
  /** 成员本次会话的临时 ECDH 公钥（base64url）；公钥非秘密 */
  clientPub: idSchema,
  status: joinStatusSchema,
  /** 审批后绑定；恢复配对保留原 memberId */
  memberId: idSchema.nullable(),
  /** 审批后下发的凭证（仅主机存；成员通过私有通道取走） */
  credential: z.string().nullable(),
  createdAt: z.number().int().min(0),
})

export type PendingJoin = z.infer<typeof pendingJoinSchema>

// ---------- 存储根（Dexie teamState 表） ----------

export const teamStateSchema = z.object({
  format: z.literal(TEAM_FORMAT),
  teamId: idSchema,
  name: z.string().min(1, '团队名不能为空'),
  /** 创建者本机角色；成员机上也是 organizer/member 由配对时主机下发 */
  myMemberId: idSchema.nullable(),
  /** 草稿版本，编辑即递增；发布时检查 sourceDraftRevision 一致 */
  draftRevision: z.number().int().min(1),
  revision: z.number().int().min(1),
  roster: z.array(teamMemberSchema).default([]),
  items: z.array(teamItemSchema).default([]),
  allocations: z.array(teamAllocationSchema).default([]),
  checkpoints: z.array(teamCheckpointSchema).default([]),
  submissions: z.array(submissionSchema).default([]),
  expenses: z.array(teamExpenseSchema).default([]),
  /** 最新发布指针；发布前为 null */
  latestPublication: publicationMetaSchema.nullable(),
  /** 发布历史（仅元数据+快照，快照存 publications 表） */
  publicationHistory: z.array(publicationMetaSchema).default([]),
  /** 主机长期凭证密钥（base64url 32 字节）；仅主机有，绝不下发、不进公共快照 */
  credentialSecret: z.string().nullable().default(null),
  /** 主机侧待审批/已审批的加入申请 */
  pendingJoins: z.array(pendingJoinSchema).default([]),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})

export type TeamState = z.infer<typeof teamStateSchema>
export type TeamMember = z.infer<typeof teamMemberSchema>
export type TeamItem = z.infer<typeof teamItemSchema>
export type TeamAllocation = z.infer<typeof teamAllocationSchema>
export type TeamCheckpoint = z.infer<typeof teamCheckpointSchema>
export type Submission = z.infer<typeof submissionSchema>
export type TeamExpense = z.infer<typeof teamExpenseSchema>
export type PublicationMeta = z.infer<typeof publicationMetaSchema>
export type TeamRole = z.infer<typeof teamRoleSchema>
export type ReviewState = z.infer<typeof reviewStateSchema>
export type UploadState = z.infer<typeof uploadStateSchema>
