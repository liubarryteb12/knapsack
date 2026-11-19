# 目标系统（Mod 07）实施计划

> 依据：[GOALS_MODULE_SPEC.md](./GOALS_MODULE_SPEC.md)（设计已确认）
> 状态：待执行
> 原则：契约先行、每阶段可独立验证、每阶段一个提交、不 push

## 0. 前置约束

1. `AIMS.md` 规定新模块必须先进入「当前阶段」才能写业务代码。本计划第 0 阶段先补这一节。
2. 模块骨架期 `enabledByDefault: false`，Phase 6 完成后再改为 `true`，避免半成品出现在导航里。
3. 所有 AI 调用只在用户点击时发生，不引入任何后台请求。
4. 每个阶段结束必须满足该阶段的验证命令，才进入下一阶段。

## 1. 阶段总览与依赖

```
P0 AIMS 立项
 └─ P1 契约与测试（schema + prompts + test）
     └─ P2 模块壳（manifest + 空页 + mod:sync）
         ├─ P3 数据层（store + 事务 CRUD）
         │   └─ P4 界面（想法池 / 目标树 / 详情 / 周期）
         │       ├─ P5 导入管线（解析 → 预览 → 事务）
         │       └─ P6 AI 两轮向导
         │           └─ P8 回归与发布门禁
         └─ P7 skill（可与 P3–P6 并行，只依赖 P1 契约）
```

P7 与 App 实现解耦，只要 P1 的字段定稿即可动工。

## 2. 分阶段任务

### P0 · AIMS 立项

**改文件**
- `AIMS.md`：新增「## 十、当前阶段：v1.4.0 目标系统（Mod 07）」，写明目标、范围（引用 spec）、验收口径；把路线图 Mod 07 状态从 `⏳ 待启动` 改为 `🟡 进行中`。

**验收**
- 人工确认节结构与现有七/八/九节一致；无业务代码。

---

### P1 · 契约与测试（TDD 起点）

**新增文件**
- `src/mods/mod-goals/schema.ts`
  - Zod：`ideaSchema`、`goalSchema`、`milestoneSchema`、`taskSchema`、`cycleSchema`
  - 草稿：`ideaDraftSchema`、`goalDraftSchema`（含 `milestones[].tasks[]`）、`cycleDraftSchema`
  - 包：`goalPackSchema`，含跨实体引用 `superRefine`、规模上限、日期格式、externalId 唯一性
  - 常量：`GOAL_PACK_FORMAT = 'goal-pack.v1'`、`GOAL_PACK_SCHEMA_VERSION = 1`、规模上限常量
  - 工厂：`newIdea()`、`newGoal()`、`newMilestone()`、`newTask()`、`newCycle()`（补齐 id/时间戳/默认状态）
  - 派生：`goalProgress()`、`milestoneProgress()`
- `src/mods/mod-goals/prompts.ts`
  - `PROMPT_VERSION = 1`
  - `buildClarifyPrompt(ideaText: string): string`
  - `buildDecomposePrompt(ideaText: string, qa: Array<{ question: string; answer: string | null }>): string`
  - 文案与 spec 第 6 节逐字一致
- `scripts/test-goal-pack.ts`
  - 覆盖 spec 8.1 的 1–7 条（契约部分）

**关键实现点**
- 跨实体引用校验在 `superRefine` 中做两遍：包内解析 + 允许外部 `externalIdSet` 通过参数注入（供导入器复用同一校验）
- 日期正则 `^\d{4}-\d{2}-\d{2}$`，并做 `startDate ≤ targetDate` 的字典序比较（同格式下安全）
- 错误信息带字段路径，例如 `goals[0].milestones[2].acceptance：不能为空`

**验证**
```powershell
npm test
```
- `test-goal-pack` 全绿；其余既有测试不回归。

**完成标准**
- 契约层无 UI 依赖、无 DB 依赖，可被 App 与 Node 测试共用。

---

### P2 · 模块壳

**新增/修改**
- `src/mods/mod-goals/manifest.ts`
  - `id: 'mod-goals'`、`name: '目标'`、`version: '1.4.0'`、`schemaRevision: 1`
  - `enabledByDefault: false`（P6 后改 true）
  - 6 张表与索引严格按 spec 第 4 节
  - 路由 `/goals`、`/goals/:id`；导航 `order: 25`
- `src/mods/mod-goals/GoalsView.vue`：占位页（三个空标签）
- `src/mods/manifest-index.ts`：由脚本重新生成，不手改

**验证**
```powershell
npm run mod:sync
npm run build
```
- `manifest-index.ts` 出现 mod-goals
- 设置页能开关模块；关闭时导航不显示
- Dexie 版本号自动变化，旧库可正常打开（新表为空）

**风险点**
- `deriveModDbVersion` 按 manifest 数量与 schemaRevision 求和，新增模块会抬版本，属于预期行为；需在浏览器里实测一次旧库升级。

---

### P3 · 数据层

**新增文件**
- `src/mods/mod-goals/store.ts`（Pinia，参照 `mod-daily/store.ts`）
  - state：`ideas`、`goals`、`milestones`、`tasks`、`cycles`、`loading`、`error`
  - getters：`activeGoals`、`goalById`、`milestonesOf(goalId)`、`tasksOf(milestoneId)`、`cyclesOf(goalId)`、各层进度
  - actions：`loadAll()`、`createIdea`、`updateIdea`、`promoteIdea(ideaId, goalDraft)`、`parkIdea`、`createGoal`、`updateGoal`、`addMilestone`、`addTask`、`setTaskStatus`、`reorderTasks`、`createCycle`、`assignTaskToCycle`、`removeTaskFromCycle`
- `src/mods/mod-goals/services/ids.ts`：`newId()` 包装 nanoid；`slugify()` 用于补 externalId

**关键实现点**
- 所有写操作 `await db.transaction('rw', ...)`，失败回滚
- 删除采用状态标记（`abandoned` / `dropped`）而非物理删除；仅「删除想法」允许物理删除并二次确认
- `promoteIdea` 在一个事务内：建目标 → 想法置 `promoted` 并回填 `goalId`
- 派生进度在 getter 中计算，不落库

**验证**
- 在 P4 页面出现前，用 `scripts/test-goal-store.ts`（可选）或临时页手测：
  - 创建目标 → 里程碑 → 任务 → 周期，刷新后数据仍在
  - 事务失败时（人为传非法数据）不留下半条记录

---

### P4 · 界面

**新增文件**
- `GoalsView.vue`（三标签容器）
- `components/IdeaPool.vue`
- `components/GoalCard.vue`
- `GoalDetailView.vue`
- `components/MilestoneList.vue`
- `components/TaskRow.vue`
- `components/CycleBoard.vue`

**实现要点**
- 沿用现有 naive-ui 组件与项目样式变量，不引入新 UI 库
- 目标详情页内联编辑，保存走 400ms 防抖（参照 mod-daily 的保存队列）
- 移动端：单列布局，任务操作用按钮而非拖拽；桌面端可选 sortablejs 拖拽排序
- 空状态文案明确下一步动作（「还没有想法，点右上角记录第一条」）

**验证**
- `npm run dev` 手测三标签与详情页
- `npm run build` 通过类型检查（`vue-tsc --noEmit`）

---

### P5 · 导入管线

**新增文件**
- `src/mods/mod-goals/services/parseGoalPack.ts`
  - `extractPackJson(text)`：优先 `goal-pack` 围栏，退化到首尾大括号
  - `parseGoalPack(text): { pack, errors }`
  - `planImport(pack, localSnapshot): ImportPlan`，结构：
    ```ts
    interface ImportPlan {
      creates: { ideas: number; goals: number; milestones: number; tasks: number; cycles: number }
      updates: { same shape }
      missing: { milestones: number; tasks: number }   // 本地有、本包无
      resolved: { pack: GoalPack; idMap: Map<string, string> }  // externalId → 本地 id
      warnings: string[]
    }
    ```
  - `commitImport(plan)`：单事务写入 + `mod_goals_imports` 记录
  - `idempotencyKey(pack)`：`sha256(source + sortedExternalIds + packDigest)`
- `components/ImportPackModal.vue`
  - 步骤：粘贴 → 解析结果 → 预览（新增/更新/未包含）→ 确认
  - 校验失败：按字段路径列出全部错误，确认按钮禁用
  - 重复导入：显示上次时间，提供「仍然导入」
- `components/ImportHistory.vue`（可选，挂在目标树页底部）

**关键实现点**
- 匹配只按 `externalId`；命中更新内容字段，不覆盖本地 status
- `cycleExternalId` / `goalExternalId` 先解析成地图再落库
- 包内缺失项不删除，只在预览提示
- 事务失败整体回滚并保留用户粘贴内容

**验证**
- `scripts/test-goal-pack.ts` 补 8–10 条（幂等、更新不覆盖 status、缺失不删除），用 `fake-indexeddb/auto` 起内存库，写法参照 `scripts/test-daily.ts`
- `planImport` 保持纯函数（不碰 DB），DB 写入只在 `commitImport` 内，便于单测
- 手工：同一包导入两次；改标题后强制再导入；缺 externalId 的包自动补 ID

---

### P6 · AI 两轮向导

**新增文件**
- `src/mods/mod-goals/services/aiDecompose.ts`
  - `askClarifications(config, ideaText, signal): Promise<ClarificationQuestion[]>`
  - `decompose(config, ideaText, qa, signal): Promise<GoalPack>`
  - 复用 `aiDraft.ts` 的 `callChat` / `extractJson` / 回喂重试模式（可在 mod-goals 内复制一份薄封装，避免跨模块依赖）
  - 超时：第一轮 30s，第二轮 90s；`temperature` 0.7 / 0.3
- `components/AiWizardModal.vue`
  - 状态机：`idle → asking → answered → generating → preview → imported`
  - 每题可答或点「不知道」；生成中可取消（AbortController）
  - 预览复用 `ImportPackModal` 的预览子组件
  - 中间状态存 `localStorage`：`knapsack.goals.ai-draft.<ideaKey>`，成功后清除
- `manifest.ts`：`enabledByDefault` 改为 `true`

**关键实现点**
- 未配置 Key 时入口置灰，点击给出跳转设置页的提示
- `source` 固定 `knapsack-ai`；`promptVersion` 写入导入记录
- 第二轮若模型返回 `format` 不符，视为校验失败走重试
- 生成结果必须经预览确认，绝不直写

**验证**
- 配 DeepSeek 实测：完整两轮、点「不知道」、断网、401、畸形 JSON 五种情况
- 中途返回列表再进入，草稿仍在

---

### P7 · skill（可与 P3–P6 并行）

**新增文件**
- `skills/knapsack-goal/SKILL.md`：内容取自 spec 7.2，去掉外层围栏
- `skills/knapsack-goal/references/goal-pack.v1.md`：字段表 + 完整示例包 + 常见错误
- `skills/README.md`：说明安装方式

**安装**
```powershell
Copy-Item -Recurse -Force skills\knapsack-goal "$env:USERPROFILE\.claude\skills\knapsack-goal"
```

**验证**
- 在 Claude Desktop 新会话里说「按 knapsack-goal 收口」触发 skill
- 产出包能通过 `scripts/test-goal-pack.ts` 里的同一 schema 校验
- 修改后的包再次导入走更新而非新增

---

### P8 · 回归与发布门禁

**执行**
```powershell
npm test
npm run audit:boundary
npm run audit:modules
npm run build
```

**手工清单**（spec 8.2 全部）
- 新建想法 → AI 拆解 → 入库
- 外部 skill 出包 → 粘贴导入
- 重复导入提示
- 进度实时变化
- 手机端导入与改状态
- 未配置 Key 的降级
- 畸形 JSON 不崩溃
- 备份/恢复包含 6 张新表

**文档**
- `docs/USER_GUIDE.md` 增加「目标」章节
- 更新 `docs/MODULE_INTERACTION_MATRIX.md`（mod-goals 与宿主、无跨模块调用）
- 如需发布：`docs/RELEASE_NOTES_v1.4.0.md`、`docs/KNOWN_ISSUES_v1.4.0.md`
- `AIMS.md` 台账回填：阶段状态、提交哈希、验证证据

## 3. 文件清单

**新增**
```
src/mods/mod-goals/
  manifest.ts
  schema.ts
  prompts.ts
  store.ts
  GoalsView.vue
  GoalDetailView.vue
  components/{IdeaPool,GoalCard,MilestoneList,TaskRow,CycleBoard,ImportPackModal,AiWizardModal,ImportHistory}.vue
  services/{ids,parseGoalPack,aiDecompose}.ts
scripts/test-goal-pack.ts
skills/knapsack-goal/SKILL.md
skills/knapsack-goal/references/goal-pack.v1.md
skills/README.md
docs/GOALS_IMPLEMENTATION_PLAN.md（本文件）
```

**修改**
```
AIMS.md
src/mods/manifest-index.ts（脚本生成）
docs/USER_GUIDE.md
docs/MODULE_INTERACTION_MATRIX.md
```

## 4. 测试矩阵

| 层 | 手段 | 覆盖 |
|---|---|---|
| 契约 | `test-goal-pack.ts` | 合法/非法包、引用、上限、日期、externalId |
| 导入 | 同上（`fake-indexeddb`）+ 手测 | 幂等、更新、缺失不删、事务回滚 |
| AI | 手测 | 两轮、不知道、超时、401、畸形 JSON |
| UI | 手测 + `vue-tsc` | 三标签、详情、内联编辑、移动端 |
| 宿主 | `audit:*` + build | 模块边界、打包、DB 升级 |
| 备份 | 手测 | 6 张表随备份导出/恢复 |

## 5. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| DB 版本抬升导致旧库打不开 | 高 | 发布前用现有数据实测升级；异常则回退 manifest 的 `schemaRevision` |
| AI 输出不稳定 | 中 | 预览强制确认；预览页提供高级 JSON 编辑 |
| 导入把本地状态覆盖 | 高 | 规则层禁止覆盖 status；补测试锁死 |
| 模块半成品影响日常使用 | 中 | P2–P5 期间 `enabledByDefault: false` |
| skill 与 App 字段漂移 | 中 | 契约测试同时校验 skill 示例包；改字段必须升 `schemaVersion` |

## 6. 提交切分

每个阶段一个提交，消息遵循现有风格：

```
feat(goals): P1 契约与校验测试
feat(goals): P2 模块壳与存储表
feat(goals): P3 数据层与事务写入
feat(goals): P4 想法池与目标树界面
feat(goals): P5 goal-pack 导入管线
feat(goals): P6 两轮 AI 拆解向导
feat(goals): P7 knapsack-goal skill
docs(goals): P8 回归、文档与验收台账
```

不执行 `git push`，除非人类明确下达 `PUSH`。

## 7. 完成定义（DoD）

全部满足才算完成：

- [ ] spec 8.1 十条自动化测试全绿
- [ ] spec 8.2 八条人工验收全过
- [ ] `npm test`、`npm run audit:boundary`、`npm run audit:modules`、`npm run build` 全部通过
- [ ] 备份/恢复实测包含 6 张新表
- [ ] `AIMS.md` 台账回填完整（状态、提交哈希、证据）
- [ ] skill 在 Claude Desktop 实测可触发且产出包可导入
- [ ] 无跨模块内部引用，无后台网络请求
