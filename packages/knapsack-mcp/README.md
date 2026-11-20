# knapsack-mcp

[Knapsack](https://github.com/liubarryteb12/knapsack) 工作区快照的只读 MCP server（stdio）。让 Claude Desktop / Claude Code 等支持 MCP 的 agent 读取你的目标、看板、人格与提示词数据。

## 数据通路

Knapsack 的数据在 IndexedDB 里，Node 进程读不到。本 server 只读取 **App 内手动导出的工作区快照 JSON**（`workspace-snapshot.v1`）：

1. 打开 Knapsack（桌面版）→「目标」页 → 右上角「导出快照」→ 选择保存位置（如 `~/.knapsack/knapsack-snapshot.json`）。
2. 配置本 server 指向该文件。
3. 数据更新后重新导出（server 会在快照超过 7 天未更新时给出提示）。

**只读保证**：本 server 不提供任何写入/删除工具；写回走 App 内 goal-pack 导入管线（v2 规划，见 `docs/BOARD_MODULE_SPEC.md` §12）。

**隐私提醒**：快照含个人目标数据。把本 server 配置进某个 agent，即授权该 agent 读取此文件。

## 配置

Claude Desktop（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "knapsack": {
      "command": "node",
      "args": ["D:\\00.AIagent\\codespace\\Knapsack\\packages\\knapsack-mcp\\src\\index.js", "--snapshot", "C:\\Users\\<你>\\.knapsack\\knapsack-snapshot.json"]
    }
  }
}
```

Claude Code（仓库根的 `.mcp.json` 已配好，在 Knapsack 仓库里启动 Claude Code 即生效；也可全局注册）：

```bash
claude mcp add knapsack -- node <仓库>/packages/knapsack-mcp/src/index.js --snapshot ~/.knapsack/knapsack-snapshot.json
```

快照路径解析优先级：`--snapshot <路径>` 参数 → `KNAPSACK_SNAPSHOT` 环境变量 → 默认 `~/.knapsack/knapsack-snapshot.json`（支持 `~/` 展开）。

## 工具面（v1 只读）

| 工具 | 返回 |
| --- | --- |
| `knapsack_get_goals` | 全部目标树（目标 → 里程碑 → 任务 → 周期），任务含看板状态、人格分派与优先级 |
| `knapsack_get_board` | 看板三列（todo/doing/done）任务、人格分派、容量占用、未分配任务 |
| `knapsack_get_roles` | 人格列表（charter、tier、容量占用、关联提示词摘要与可用性） |
| `knapsack_get_prompts` | 提示词目录（标题/分面/摘要）；`promptId` 参数取单条正文 |

快照文件缺失/损坏时，工具返回配置引导文案，不抛协议错误。

## 开发

```bash
npm install
npm test   # node --test：fixture 投影测试 + stdio 协议冒烟
```

契约防漂移：`fixtures/snapshot.example.json` 由 Knapsack 仓库的 `scripts/test-workspace-snapshot.ts` 自动生成/更新，两端测试共用同一 golden 样例。
