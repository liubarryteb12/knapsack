/**
 * workspace-snapshot.v1 读取端 schema（与 Knapsack src/mods/mod-goals/schema.ts 同构）。
 *
 * 契约防漂移：仓库回归测试 scripts/test-workspace-snapshot.ts 会把 App 侧组装的快照
 * 固化为 fixtures/snapshot.example.json，本包测试用它校验读取端 schema。
 * 读取端刻意宽松（passthrough），只校验格式与关键字段，避免 App 加字段就坏。
 */
import { z } from 'zod'

export const SNAPSHOT_FORMAT = 'workspace-snapshot.v1'
export const SNAPSHOT_SCHEMA_VERSION = 1

const dateStr = z.string()
const timestamp = z.string()

const goalSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    why: z.string().optional().default(''),
    successCriteria: z.string().optional().default(''),
    horizon: z.string().optional(),
    startDate: dateStr,
    targetDate: dateStr.optional(),
    status: z.enum(['draft', 'active', 'paused', 'done', 'abandoned']),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .passthrough()

const milestoneSchema = z
  .object({
    id: z.string().min(1),
    goalId: z.string().min(1),
    title: z.string(),
    acceptance: z.string().optional().default(''),
    targetDate: dateStr.optional(),
    status: z.enum(['todo', 'active', 'done', 'missed']),
    order: z.number().int().optional(),
  })
  .passthrough()

const taskSchema = z
  .object({
    id: z.string().min(1),
    milestoneId: z.string().min(1),
    title: z.string(),
    detail: z.string().optional().default(''),
    estimate: z.enum(['S', 'M', 'L']).optional(),
    dueDate: dateStr.optional(),
    cycleId: z.string().optional(),
    status: z.enum(['todo', 'doing', 'done', 'dropped']),
    order: z.number().int().optional(),
    roleId: z.string().optional(),
    boardOrder: z.number().int().optional(),
    boardPriority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  .passthrough()

const cycleSchema = z
  .object({
    id: z.string().min(1),
    goalId: z.string().min(1),
    label: z.string(),
    startDate: dateStr,
    endDate: dateStr,
    focus: z.string().optional().default(''),
  })
  .passthrough()

const roleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    tier: z.enum(['lead', 'specialist', 'helper']).optional(),
    charter: z.string().optional().default(''),
    promptId: z.string().optional(),
    promptTitle: z.string().optional(),
    maxDoing: z.number().int().optional(),
    active: z.boolean().optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .passthrough()

const promptSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    systemRole: z.string().optional().default(''),
    templateBody: z.string().optional().default(''),
    outputFormat: z.string().optional(),
    facets: z
      .object({
        targetTool: z.array(z.string()).optional().default([]),
        domainTheme: z.array(z.string()).optional().default([]),
        styleTechnique: z.array(z.string()).optional().default([]),
      })
      .passthrough()
      .optional(),
    updatedAt: z.number().optional(),
  })
  .passthrough()

export const snapshotSchema = z
  .object({
    format: z.literal(SNAPSHOT_FORMAT),
    schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
    createdAt: timestamp,
    source: z.string().optional(),
    ideas: z.array(z.object({ id: z.string() }).passthrough()).optional().default([]),
    goals: z.array(goalSchema).default([]),
    milestones: z.array(milestoneSchema).default([]),
    tasks: z.array(taskSchema).default([]),
    cycles: z.array(cycleSchema).default([]),
    roles: z.array(roleSchema).default([]),
    prompts: z.array(promptSchema).default([]),
  })
  .passthrough()
