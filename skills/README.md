# skills

Claude Code / Claude Desktop 可安装的技能源文件。

## 安装 `knapsack-goal`

```powershell
Copy-Item -Recurse -Force skills\knapsack-goal "$env:USERPROFILE\.claude\skills\knapsack-goal"
```

安装后在 Claude Desktop 里说「按 knapsack-goal 收口」即可触发。技能产出的 `goal-pack.v1`
可粘贴进 Knapsack「目标」模块的导入框，预览确认后入库。

字段改动的顺序：先改 `src/mods/mod-goals/schema.ts`，再同步
`skills/knapsack-goal/references/goal-pack.v1.md`，最后升 `schemaVersion` 并跑 `npm test`。
