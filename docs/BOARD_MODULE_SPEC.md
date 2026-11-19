# 看板与主理人（Goals Board）设计规格

> 状态：v1.0（B1–B5 已实现并验收，2026-11-20；§12 MCP 平台化待立项）
> 适用版本：v1.5.0 起
> 定位：目标系统（Mod 07）的扩展，不新开模块
> 关联文档：[GOALS_MODULE_SPEC.md](./GOALS_MODULE_SPEC.md)、[V4_MODULARIZATION_PLAN.md](./V4_MODULARIZATION_PLAN.md)

## 1. 背景与目标

目标系统已经解决了「想法 → 澄清 → 目标树」，但目标落地之后仍缺一层：**谁来做、现在卡在哪、下一步先动哪个**。

本设计补上三件事、两条联动：

1. **跨目标看板**：把所有进行中目标的任务放在同一块板上，按 `todo / doing / done` 推进。
2. **联动一 · 目标 → 看板**：目标模块拆解出的任务进入看板。可在拆解完成时自动送入，也可在看板上手动添加/接收。
3. **联动二 · 看板 ↔ 提示词池**：看板直接读取提示词库里的 WORK_LLM 条目，**一个条目就是一个可分配的工作人格**（研究者、写作者、审阅者……）。看板不另外维护一套人格文本。
4. **主理人分派**：AI 以「看板主理人」身份（可理解为一块主控提示词）读一遍看板，提取每个任务的特征，匹配提示词池里的人格，产出分派草案；用户确认后才写库。分派同时支持**手动**：卡片上直接选人格。

一句话：**目标是任务的来源，提示词池是人格的来源，看板是两者相遇并决定「谁来做」的地方。**

设计原则沿用目标系统，并新增两条：

1. **契约优先**：任务、角色、分派草案都是 Zod schema，UI 与 AI 共用。
2. **本地优先**：不引入后台请求，AI 只在点击「主理人开会」时调用一次。
3. **建议而非执行**：主理人只产出草案，永不直接改库；用户确认是唯一写入口。
4. **提示词不复制**：看板角色直接引用提示词库的条目，编辑入口只有提示词库一处。

## 2. 范围

### MVP 包含

- 目标页新增「看板」标签：列 = 待办 / 进行中 / 已完成
- 任务增加 `roleId`，可手工拖拽、也可由主理人建议
- 角色管理：名称、层级、职责说明、容量、关联提示词库条目，支持从提示词库**一键导入人格**
- 主理人分派：一次模型调用 → 草案预览 → 用户确认 → 事务写入
- 与提示词库的只读互通（新增 capability，不跨模块 import）
- 目标「送入看板」入口：AI 拆解完成或导入完成后可一键进入

> 澄清/拆解提示词的库覆盖机制同源，但排在 v1.1（见 §8.3）。

### MVP 不包含

- 后台自动分派、定时重排、自动执行任务
- 多个角色并行调用模型「干活」（角色目前只是分派维度，不是 agent 运行时）
- 独立 `mod-board` 模块（见 §12 决策）
- 看板分享、跨设备同步、与「每日」「行程」模块联动
- 目标澄清/拆解提示词的库覆盖（机制预留，见 §8.3，排在 v1.1）

## 3. 核心流程

```
想法（raw）
  → AI 两轮澄清 + 拆解（已有）
  → 目标 draft / active（已有）
  → 「送入看板」                    ← 新增
  → 看板：todo / doing / done      ← 新增
  → 「主理人开会」→ 分派草案        ← 新增（自动）
  → 用户确认 → 写入 task.roleId
  → 或：卡片上直接选人格            ← 新增（手动，立即生效）
  → 人工拖动推进状态（已有字段）
```

入板规则（避免看板变垃圾场）：

- 只显示 `status = active` 的目标下的任务；`draft` 目标不显示。
- 没有任务的目标不出卡片，只在工具条的「未拆解」提示里列出。
- `task.status = dropped` 默认隐藏在折叠区，不计入进度。

「送入看板」= 把目标状态从 `draft` 改为 `active`，并在 AI 向导/导入完成的成功页提供一个复选框（默认勾选）。已 active 的目标无需操作。

## 4. 数据契约变更

### 4.1 Task 扩展

在现有 [schema.ts](../src/mods/mod-goals/schema.ts) 的 `taskSchema` 上增加两个可选字段，向后兼容（旧数据读出来是 `undefined`）：

```ts
interface Task {
  // ...现有字段不变
  roleId?: string           // 指向 BoardRole.id；空 = 未分派
  boardOrder?: number       // 看板列内排序；空 = 回退到 order
  boardPriority?: 1 | 2 | 3 // 看板内的推进优先级，默认 2；不影响 goal.priority
}
```

状态机不变：`todo → doing → done | dropped`。看板列只是同一状态的不同呈现：

| 列 | 状态 |
|---|---|
| 待办 | `todo` |
| 进行中 | `doing` |
| 已完成 | `done` |
| 已放弃（折叠） | `dropped` |

### 4.2 BoardRole

```ts
type RoleTier = 'lead' | 'specialist' | 'helper'

interface BoardRole {
  id: string
  name: string            // 如「研究者」「审稿人」
  tier: RoleTier          // 主责 / 专职 / 辅助，对应「大人物 / 小人物 / 跑龙套」
  charter: string         // 职责说明，一句话讲清这个角色接什么任务
  promptId?: string       // 指向提示词库 WORK_LLM 条目
  promptTitle?: string    // 展示用快照；正文永不复制
  maxDoing: number        // 同时进行中的任务上限，默认 2
  active: boolean
  createdAt: string
  updatedAt: string
}
```

`tier` 只影响主理人的分派偏好（lead 优先接关键路径任务），不构成权限差异。

### 4.3 分派草案（不落库）

```ts
interface DispatchDraft {
  createdAt: string
  model: string
  promptId?: string          // 本次使用的主理人提示词（空 = 内置）
  assignments: Array<{
    taskId: string
    roleId: string
    priority: 1 | 2 | 3
    reason: string           // ≤ 40 字
  }>
  unassigned: Array<{
    taskId: string
    reason: string
  }>
  notes: string
}
```

草案只存在于内存 + `localStorage`（键 `knapsack.board.draft`，崩溃可恢复），**不写入 IndexedDB**；应用或取消后清除。

### 4.4 看板设置

不入库，存 `localStorage`（键 `knapsack.board.settings`）：

```ts
interface BoardSettings {
  moderatorPromptId?: string   // 主理人提示词；空 = 内置
  groupBy: 'goal' | 'role'     // 卡片分组方式
  showDoneDays: 7 | 14 | 30    // 已完成列回看窗口
  hiddenGoalIds: string[]
}
```

### 4.5 存储与版本

`mod-goals` 的 `schemaRevision` 从 `1` 升到 `2`：

| 表 | 变更 |
|---|---|
| `mod_goals_tasks` | 新增可选字段 `roleId`、`boardOrder`；新增索引 `roleId` |
| `mod_goals_roles` | 新表，`keyPath: 'id'`，索引 `active`、`tier`、`updatedAt` |

只做加法，不迁移旧记录；Dexie 版本号由宿主的 `deriveModDbVersion` 自动抬升。

## 5. 角色模型

### 5.1 角色与提示词库的关系

**人格优先**：提示词库里的每一条 WORK_LLM 提示词，本身就是一个可分配的人格。看板不发明人格，只建立「引用 + 少量看板元数据」。

- 角色 = **一条 WORK_LLM 提示词的引用** + **看板元数据**（`tier` / 容量 / 可选职责补充）。
- 「从提示词库导入人格」：选择一个条目 → 用条目标题作角色名、用 `systemRole` 前 120 字作 `charter` 初稿 → 落一条 `BoardRole`；用户可再改看板元数据。
- 角色表只存 `promptId` 与 `promptTitle` 快照，不复制提示词正文，避免两处漂移。
- 编辑人格 = 跳转 `/prompts` 编辑那条提示词；看板只负责选择、导入与使用。
- 提示词被删除时：角色标黄「提示词已失效」，分派退化为仅用 `charter`，预览页提示。
- 也允许「无提示词的纯角色」（只写 `charter`），但默认引导用户先去提示词库建人格。

### 5.1.1 两种分配方式

| 方式 | 入口 | 行为 |
|---|---|---|
| 手动 | 卡片上的角色框 / 多选后「批量分配」 | 立即写库，不调 AI；人说了算 |
| 自动 | 工具条「主理人开会」 | 产出草案 → 预览 → 确认后写库（§7） |

两种方式共用同一份人格列表；手动结果默认优先，自动分派不会覆盖（§7.4）。

### 5.2 主理人

主理人是**特殊角色**：不出现在分派目标里，也不接受任务。它是一块主控提示词，负责「读任务特征 → 匹配人格 → 出草案」。

- 提示词来源：`BoardSettings.moderatorPromptId` → 提示词库条目；为空则用内置 `buildDispatchPrompt()`。
- 无论来源如何，**输出契约由代码追加**（JSON 结构、ID 约束、容量约束）。用户在提示词库里能改人格与工作方式，改不坏解析。
- 内置三类角色模板（不落库，仅「新建角色」时的可选项）：执行者（specialist）、审阅者（specialist）、研究助手（helper）。

## 6. 界面

### 6.1 位置

`GoalsView.vue` 新增第四个标签「看板」（`activeTab: 'board'`），不改导航结构，不新增路由。

| 标签 | 变化 |
|---|---|
| 目标树 | 不变；目标卡片菜单加「送入看板」 |
| 想法池 | 不变 |
| 周期 | 不变（周期 = 时间维度，看板 = 状态维度，互不替代） |
| 看板 | 新增 |

### 6.2 看板主体

- 顶部工具条：目标筛选、角色筛选、分组切换（目标 / 角色）、「管理角色」、「主理人开会」。
- 手动分配：卡片上的角色框可直接点选更换；勾选多张卡片后「批量分配」给同一人格。手动写入立即生效，不走 AI。
- 三列卡片；卡片内容：任务标题、目标色点 + 目标名、里程碑名、`role` 标签、估算 S/M/L、截止日期、状态。
- 桌面端拖拽换列与排序（沿用 `sortablejs`，项目已有依赖）；移动端卡片菜单提供「移动到 → 待办 / 进行中 / 已完成」。
- 未分派任务在卡片上显示虚线角色框。
- 空状态：
  - 没有 active 目标 → 引导去目标树。
  - 没有角色 → 引导「从提示词库导入人格」或新建角色，说明「主理人会从这些人格里挑人」。

### 6.3 角色管理弹窗

列表 + 新建/编辑表单：名称、层级、职责说明、关联提示词（从 capability 拉取 WORK_LLM 条目，可按标题搜索）、`maxDoing`、启用开关。删除采用 `active = false`，不物理删除，避免历史任务悬空。

### 6.4 主理人预览弹窗

一张差异表，而不是原始 JSON：

| 任务 | 当前角色 | 建议角色 | 理由 | 冲突 |
|---|---|---|---|---|
| 收集 20 个读者问题 | — | 研究助手 | 需要外部信息检索 | 该角色已满 2 个进行中 |

底部：「全部应用」「只应用无冲突项」「重新开会」「取消」。没有勾选即不写库。

## 7. 主理人分派协议

匹配思路固定为三步，提示词与校验都围绕它：

1. **提取任务特征**：动作类型（检索 / 写作 / 设计 / 审阅 / 执行）、产出物、所属领域、依赖关系、体量（S/M/L）。
2. **匹配人格**：只从当前可用人格列表里选；依据人格名称、`tier`、`charter`，以及关联提示词的 `systemRole` 摘要。
3. **给出解释**：每条建议必须带上 `traits`（从任务里提炼的短标签）与 `reason`（为什么这个人格合适），让人能快速判断对错。

### 7.1 输入组装

```ts
interface BoardSnapshot {
  goals: Array<{ id: string; title: string; priority: 1 | 2 | 3 }>
  roles: Array<{
    id: string
    name: string
    tier: RoleTier
    charter: string
    personaSummary: string   // 关联提示词的 systemRole 摘要，最多 120 字；无提示词时为空
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
```

只送 `todo / doing` 任务，`done / dropped` 不参与；用户素材统一包在 `<board_data>` 标签内，并保留现有 `DATA_NOTE` 的「只作为数据」声明。

### 7.2 输出契约

```json
{
  "assignments": [
    {
      "taskId": "abc123",
      "roleId": "role-research",
      "priority": 1,
      "traits": ["外部检索", "产出清单"],
      "reason": "需要外部信息检索，该人格职责匹配"
    }
  ],
  "unassigned": [
    { "taskId": "def456", "reason": "现有角色职责都不匹配" }
  ],
  "notes": "本周优先推进关键路径上的 3 个任务"
}
```

硬性约束（写入提示词，同时由代码校验）：

1. `taskId` 只能来自输入；`roleId` 只能来自角色列表。
2. 不得新增、删除、改写任务或角色。
3. 只处理 `todo / doing` 任务；`done / dropped` 一律忽略。
4. 每个角色建议的 `doing` 数不超过 `maxDoing`；超出时优先放弃低优先级建议，而不是硬塞。
5. 无法判断的任务放进 `unassigned` 并给出理由，不要强行分配。
6. 每条建议必须有 1–3 个 `traits`，且只能从任务标题/详情中提炼，不得编造。
7. `reason` ≤ 40 字，必须说明「任务特征 → 人格职责」的对应关系；`notes` ≤ 200 字。
8. 只输出 JSON，禁止解释文字和 Markdown 代码块标记。

参数：`temperature: 0.2`，超时 60s，校验失败回喂错误重试 1 次（沿用 `aiDecompose.ts` 的 `extractJson` + `safeParse` 模式）。

### 7.3 校验与应用

```ts
dispatchDraftSchema.safeParse(extractJson(text))   // 结构
validateDispatch(draft, snapshot)                  // 引用完整性、重复 taskId、容量
applyDispatch(draft)                               // 单事务 bulkPut roleId / boardOrder
```

- 引用不存在的 `taskId / roleId`：丢弃该条并在预览页列出。
- `traits` 缺失或超过 3 个：允许通过，但在预览页降级为「无解释」样式，不阻断。
- 容量超限：保留建议但标记「冲突」，默认不勾选。
- 应用只写 `roleId`、`boardOrder`、`boardPriority`；**永不改 `status`**。草案里的 `priority` 映射到 `boardPriority`。
- 提供「清空本目标的角色分派」操作，作为整体回退手段；不做逐条撤销栈。

### 7.4 手动优先

手工设置的 `roleId` 不自动被主理人覆盖：草案中只对「当前角色为空」或用户勾选「允许重新分派」的任务生效。避免 AI 反复推翻人的决定。

## 8. 与提示词库互通

### 8.1 新增只读契约

在 [capabilityContracts.ts](../src/core/capabilityContracts.ts) 增加：

```ts
export const WORK_PROMPT_CATALOG_TOPIC = 'capability:work-prompt-catalog' as const

export interface WorkPromptProjection {
  id: string
  title: string
  systemRole: string
  templateBody: string
  outputFormat: 'MARKDOWN' | 'JSON' | 'TABLE' | 'CODE' | 'PLAIN'
  facets: { targetTool: string[]; domainTheme: string[]; styleTechnique: string[] }
  updatedAt: number
}
```

`mod-prompts` 在 `manifest.providesCapabilities` 注册，异步 `import` 服务后从 Dexie 读取 `WORK_LLM` 条目并投影。看板通过 `modRegistry.capabilities.query()` 消费。

**不允许**兄弟模块直接 import（`npm run audit:modules` 会拦），这也正好保证提示词库关闭时看板仍能工作：`query()` 返回空数组，走内置提示词。

### 8.2 使用方式

- 角色选择器：显示标题 + 三轴分面，可按标题/分面过滤。
- 「从提示词库导入人格」：多选若干 WORK_LLM 条目 → 批量生成角色草稿（标题作名、`systemRole` 摘要作 `charter`），确认后落库。
- 主理人选择器：同上，只列 WORK_LLM。
- 打开「查看提示词」用现有 `/prompts` 路由深链，不在看板内复制编辑器。

### 8.3 后续扩展（v1.1，不在本次范围）

同一 catalog 可覆盖目标模块的另外两个提示词槽位：

| 槽位 | 现值 | 覆盖后 |
|---|---|---|
| `goal.clarify` | 硬编码于 [prompts.ts](../src/mods/mod-goals/prompts.ts) | 从提示词库选条目，代码仍追加输出 JSON 契约 |
| `goal.decompose` | 同上 | 同上 |
| `board.dispatch` | 本次实现 | 本次实现 |

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| 未配置 API Key | 「主理人开会」置灰，提示去设置页配置 |
| 提示词库模块被关闭 | capability 返回空；角色提示词显示「未关联」，主理人用内置提示词 |
| 关联提示词被删除 | 角色上黄标「提示词已失效」，分派退化为 `charter` |
| 网络不通 | 提示「网络不通或地址错误」，不重试 |
| 返回非 JSON / 校验失败 | 回喂错误重试 1 次；仍失败展示原文片段，草案不生成 |
| 引用了不存在的 ID | 丢弃该条，预览页列出，不阻断其余建议 |
| 容量冲突 | 标记冲突，默认不勾选 |
| 写库失败 | 单事务回滚，提示失败原因，不留半套分派 |
| 看板无 active 目标 | 空状态引导，不发起 AI 请求 |

## 10. 测试与验收

### 自动测试

- `scripts/test-board-schema.ts`
  - 旧任务（无 `roleId`）通过校验，读取后字段为 `undefined`
  - `boardRoleSchema`、`dispatchDraftSchema` 的边界：空数组、重复 taskId、未知 roleId、超长 reason
  - `validateDispatch`：容量冲突、未分派、手工角色保护
- `scripts/test-dispatch-prompt.ts`
  - 快照序列化包含 DATA_NOTE；`done / dropped` 不出现；角色 `doingCount` 正确
- capability 契约
  - `mod-prompts` 关闭时 `query()` 返回 `[]`，看板 fallback 不抛错

### 命令

```
npm test
npm run audit:modules
npm run build
```

### 人工验收

1. 目标 `draft` 不进看板；点「送入看板」后出现。
2. 手工拖拽换列、换顺序，刷新后保持。
3. 新建角色并关联提示词库条目；删除该提示词后角色显示失效，分派仍可完成。
4. 主理人分派：草案预览 → 只应用无冲突项 → 只改 `roleId`，不改 `status`。
5. 手工指定的角色在下次「开会」中不被覆盖（除非勾选「允许重新分派」）。
6. 断网/无 Key/提示词库关闭三种降级路径不崩。

## 11. 分阶段落地

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| P1 | schema 扩展 + 角色表 + 迁移 | 旧库可打开，旧任务正常显示；契约测试绿 |
| P2 | 看板视图 + 手工拖拽 + 手动分配 + 角色管理 | 不接 AI 也能完整使用；移动端可换列、换人格 |
| P3 | 提示词库 capability + 人格导入 + 选择器 | prompt 模块开/关两种状态都可用 |
| P4 | 主理人分派 | 草案预览、冲突标记、事务应用、手工优先 |

每阶段单独提交，不 push；P2 结束后可先让用户试用再进 P3/P4。

## 12. 平台化：让任意 Agent 读写 Knapsack（MCP）

> 状态：方向确认（2026-11-20），实现排在看板 P4 之后
> 范围：目标/看板数据开放给外部 agent；UI 不变

用户定位：**Knapsack 是平台，AI 只是搭好的执行层**。任何 agent（Claude Desktop、Claude Code、Codex 等）都应能读取本软件的数据来干活。MVP 已有 `goal-pack.v1` 粘贴导入与 `knapsack-goal` skill，但只有「人搬数据」这一个方向；本节定义「agent 直接读写」的方向。

### 12.1 形态选择：MCP Server

标准协议是 **Model Context Protocol（MCP）**：Claude Desktop / Claude Code / 各主流 agent 平台都原生支持，一个 server 同时适配所有客户端，不用逐家适配。

- 形态：本地 stdio MCP server（`npx` 启动，如 `knapsack-mcp`），与 App 同机运行。
- 客户端配置一次（如在 Claude Desktop 的 MCP 配置里加一条），之后 agent 就能看到 Knapsack 的工具列表。

### 12.2 数据通路（关键约束）

App 的数据在 IndexedDB（浏览器/WebView）里，MCP server（Node 进程）读不到。方案分层：

| 阶段 | 通路 | 说明 |
|---|---|---|
| MCP-v1（推荐起点） | **导出文件桥**：App 内「导出工作区快照」→ 单个 JSON 文件（goal-pack 超集）落盘到约定目录；MCP server 读该文件 | 纯只读，零新协议，先让 agent 能「读」 |
| MCP-v2 | **双向文件桥**：agent 经 MCP 写回 goal-pack 文件 → App 内「从文件导入」拾取（复用现有导入管线，天然幂等） | agent 能「写」，但经人确认 |
| MCP-v3 | Tauri 侧 IPC /局域网会话（已有 `lan-share-engine` 基础）做实时读写 | 重构，后置 |

v1/v2 完全复用 `goal-pack.v1` 契约与现有校验、幂等导入逻辑——**契约不变，只换运输方式**。

### 12.3 MCP 工具面（v1 只读集）

| 工具 | 返回 |
|---|---|
| `knapsack_get_goals` | 全部目标树（目标/里程碑/任务/周期），含看板状态与角色 |
| `knapsack_get_board` | 看板快照：列、任务、人格分派、容量占用 |
| `knapsack_get_roles` | 人格列表（含关联提示词摘要） |
| `knapsack_get_prompts` | 提示词库目录（标题/分面/摘要；正文按需） |

v2 增加：`knapsack_import_pack`（goal-pack 写回，走文件桥）。

### 12.4 与现有资产的复用

- `goal-pack.v1` schema：导出即序列化、导入即校验，两端契约唯一。
- `knapsack-goal` skill：升级为「读快照 → 讨论 → 产出 pack → 让 MCP 写回」的闭环（v2 后）。
- `lan-share-engine` / 团队分享：v3 的实时通道可复用其协议骨架。

### 12.5 安全边界

- MCP server 只暴露约定的导出文件，不直接开 IndexedDB；不提供删除类工具。
- 导出快照含个人目标数据，提醒用户：配置 MCP 即授权本机 agent 读取该文件。
- 写回永远经 App 导入管线（预览 + 确认），agent 无法绕过人直接改库。

### 12.6 验收口径（v1）

1. App 内一键导出快照 JSON，字段与 goal-pack 兼容并扩展看板字段。
2. `knapsack-mcp` 在 Claude Desktop 注册后，agent 能列出目标树与看板状态并正确作答。
3. 无快照文件时工具返回明确空态，不抛错。



### 已定

- **v1 放在 `mod-goals` 内**，不新开 `mod-board`。原因：capability 目前明确只读，新模块无法把分派结果写回目标模块；拆模块需要先扩展宿主契约（写能力或事件总线），不属于本次范围。拆出条件：看板要接入非目标来源的任务，或宿主引入跨模块写契约。
- **角色即提示词引用**，不复制正文。互通不是额外桥接，而是同一份数据；人格由提示词库定义，看板只做引用、导入与容量标注。
- **手动与自动并列**：手动分配是完整可用的主路径，主理人是加速器；不存在「必须先用 AI」的环节。
- **主理人只出草案**，不做后台自动分派，也不让角色真的并行执行任务。

### 风险

| 风险 | 说明 | 对策 |
|---|---|---|
| 分派质量依赖角色描述 | `charter` 写得空泛，AI 只能瞎分 | 新建角色表单给示例与占位文案；预览页展示理由，方便校准 |
| 看板与周期视图重叠 | 用户可能分不清两个「板」 | 文案明确：周期排时间，看板排状态；看板支持按周期筛选但不替代排期 |
| 提示词库条目被改名/删除 | 角色失去人格 | 存标题快照 + 失效提示 + `charter` 兜底 |
| schemaRevision 抬升 | 旧库升级 | 只加可选字段与新表，回归测试覆盖旧数据读取 |
| 大模型编造 taskId | 解析失败 | 严格引用校验 + 丢弃 + 预览页列出，不阻断其余条目 |

### 待人类确认

1. 「送入看板」是否默认勾选？（建议：是）
2. 角色 `tier` 用「主责 / 专职 / 辅助」还是保留「大人物 / 小人物 / 戏份」的说法？
3. 已完成列默认回看 7 天还是全部？
4. 是否需要在 P2 就上线，先不接 AI，收集一轮真实使用反馈？
