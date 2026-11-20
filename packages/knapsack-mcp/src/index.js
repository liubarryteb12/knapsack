#!/usr/bin/env node
/**
 * knapsack-mcp：Knapsack 工作区快照的只读 MCP server（stdio）。
 *
 * 用法：
 *   knapsack-mcp --snapshot /path/to/knapsack-snapshot-YYYYMMDD.json
 *   KNAPSACK_SNAPSHOT=/path/to/snapshot.json knapsack-mcp
 *
 * 只读：仅读取 App 手动导出的 workspace-snapshot.v1 文件，不接触数据库，
 * 不提供写入/删除类工具。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadSnapshot, resolveSnapshotPath } from './loader.js'
import { buildBoard, buildGoalTree, buildPrompts, buildRoles } from './tools.js'

const snapshotPath = resolveSnapshotPath()

const server = new McpServer({
  name: 'knapsack-mcp',
  version: '0.1.0',
})

/** 统一包装：快照缺失/损坏时返回引导文案（isError=false），不抛错 */
async function respond(build) {
  const loaded = await loadSnapshot(snapshotPath)
  if (!loaded.ok) {
    return { content: [{ type: 'text', text: loaded.message }] }
  }
  const payload = build(loaded.snapshot)
  const notes = [loaded.note].filter(Boolean)
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          notes.length > 0 ? { ...payload, notes } : payload,
          null,
          2,
        ),
      },
    ],
  }
}

server.registerTool(
  'knapsack_get_goals',
  {
    title: '读取 Knapsack 目标树',
    description:
      '返回 Knapsack 全部目标（含草稿/暂停/完成）及里程碑、任务、周期。任务含看板状态、人格分派与优先级。',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => respond((snapshot) => ({ exportedAt: snapshot.createdAt, goals: buildGoalTree(snapshot) })),
)

server.registerTool(
  'knapsack_get_board',
  {
    title: '读取 Knapsack 看板',
    description:
      '返回看板三列（todo/doing/done）任务、人格分派、各人格容量占用与未分配任务。只含 active 目标的任务。',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => respond((snapshot) => buildBoard(snapshot)),
)

server.registerTool(
  'knapsack_get_roles',
  {
    title: '读取 Knapsack 人格',
    description: '返回全部人格（含停用），附 charter、容量占用与关联提示词摘要及可用性。',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => respond((snapshot) => ({ exportedAt: snapshot.createdAt, roles: buildRoles(snapshot) })),
)

server.registerTool(
  'knapsack_get_prompts',
  {
    title: '读取 Knapsack 提示词目录',
    description:
      '默认返回提示词目录（标题/分面/摘要）。传 promptId 取单条正文；includeBody=true 让目录附带正文。',
    inputSchema: {
      promptId: z.string().optional().describe('取单条提示词（含正文）'),
      includeBody: z.boolean().optional().describe('目录是否附带正文，默认 false'),
    },
    annotations: { readOnlyHint: true },
  },
  (args) =>
    respond((snapshot) => ({
      exportedAt: snapshot.createdAt,
      ...buildPrompts(snapshot, { promptId: args.promptId, includeBody: args.includeBody }),
    })),
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[knapsack-mcp] 快照路径：${snapshotPath}`)
