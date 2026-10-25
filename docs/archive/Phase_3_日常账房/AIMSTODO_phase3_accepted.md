# AIMSTODO · 行囊当前执行任务流水

> **AI 执行守则**：
> - 状态符号约定：`[ ]` 待办 ｜ `[/]` 正在执行（全表全局仅限 1 项） ｜ `[x]` 已完成且通过验证 ｜ `[-]` 已取消/废弃
> - 严禁跳步：前一项未验证通过前，禁止将后续项标记为 `[/]`。
> - 交付纪律：每将一项标记为 `[x]`，必须在下方【执行日志】追加 1-2 行实测证据。

---

## 一、 当前进行中（Active WIP）

- **所属模块**：Phase 3 日常账房（mod-finance）
- **当前目标**：Phase 3 已构建并安装到手机/电脑，等待最终审查反馈
- **状态**：`[x]`

---

## 二、 原子任务拆解清单（Task Breakdown）

### 阶段 0：砍掉远程过度设计（AIMS 细节 D）
- [x] 0.1 移除 `organizer.state` / `organizer.teamEdit` 协议动作、主机分发、client 方法
- [x] 0.2 组织者操作卡片改名为「组织者操作」，去掉远程拉状态与远程改分工语义

### 阶段 1：数据层与协议打通
- [x] 1.1 快照 schema 补充 `releaseNote?: string`（细节 A）
- [x] 1.2 发布动作 `publishSnapshot` 落库 releaseNote，host 分发透传
- [x] 1.3 成员端快照详情顶部展示寄语卡片（空则隐藏，不占空行）
- [x] 1.4 边界测试：Emoji/多行/500 字边界/空值（scripts/test-release-note.ts）

### 阶段 2：UI 渲染与交互降噪
- [x] 2.1 组织者发布弹窗增加说明输入（prompt，限制 500 字，非必填）
- [x] 2.2 团长端待审列表「已修订」角标 + 展开前后数值对比（细节 B）
- [x] 2.3 降噪处理：`.team-public` / `.team-submit` 导入导出收进「更多」折叠菜单（细节 C）
- [x] 2.4 顺手修复：旧版报告重复占位（pending 去重）

### 阶段 3：全量回归防线
- [x] 3.1 运行既有 9 项回归测试 + 新增返修测试，全部通过
- [x] 3.2 真机 UI 验证（人工开启 USB 安装权限后通过）

### 阶段 4：AIMS Phase 1 验收返修（2026-10-23）
- [x] 4.1 P0：统一团队 `/action` 请求 AAD，客户端加密与主机解密使用同一基础 AAD，补协议回归测试
- [x] 4.2 P0：发布预览摘要改为确定性生成，发布说明参与预览比对，修复本机发布必被拒
- [x] 4.3 P1：发布幂等摘要纳入 `releaseNote` 和预览摘要，同一 operationId 换内容必须冲突
- [x] 4.4 P1：发布、回执、修订操作号改为稳定值，丢 ACK 重试不重复发版/回执
- [x] 4.5 P1：成员端补「我的上报」与修订入口，沿用 submissionId/expenseReportId，revision 递增
- [x] 4.6 P1：自定义分摊改用 `yuanToFen`，校验合计等于金额，删除重复 spread
- [x] 4.7 P1：`TeamSummaryTab` 报告文件导入收进「更多」，主界面保留高频操作
- [x] 4.8 P1：发布说明统一为 500 字边界，验证 Emoji、多行、空值和超长输入
- [x] 4.9 P1：清理「手机放家里远程汇总」残留语义，按 AIMS 的面对面组团边界收敛
- [x] 4.10 全量回归：9 个历史脚本 + 新增返修脚本全过，`npm run build`、`vue-tsc --noEmit` 通过
- [x] 4.11 回填 `AIMS.md` 验收台账与 `AIMSTODO.md` 执行日志，完成人工验收清单

### 阶段 5：Phase 2 mod-daily 日常规划（2026-10-23 启动）
- [x] 5.1 建立 `src/core/modRegistry.ts`，登记旅行与日常模块，支持导航和本地开关
- [x] 5.2 建立 `src/mods/mod-daily/` schema、Dexie v3 表与 store
- [x] 5.3 实现 `/daily` 每日计划：日期切换、任务增删改、时间块、完成状态
- [x] 5.4 实现随手备忘自动保存与三问复盘持久化
- [x] 5.5 增加模块设置入口与移动端布局
- [x] 5.6 新增 `scripts/test-daily.ts`，覆盖 schema、日期隔离、CRUD、特殊字符与空值
- [x] 5.7 全量回归 13 个测试脚本 + `npm run build`，确认旅行模块不回归
- [x] 5.8 回填 AIMS Phase 2 台账与 UI 复核清单

### 阶段 6：Phase 3 mod-finance 日常账房（2026-10-23 启动）
- [x] 6.1 扩展 ModRegistry、路由、导航和设置开关，登记 `finance`
- [x] 6.2 建立 `finance-entry.v1` schema、Dexie v4 表和 store
- [x] 6.3 实现 `/finance` 快速记账、编辑、删除和分类筛选
- [x] 6.4 实现月度汇总、近 7 日趋势和消费结构占比
- [x] 6.5 支持从旅行花费导入，按来源去重，不修改旅行账本
- [x] 6.6 新增 `scripts/test-finance.ts`，覆盖金额整数分、分类统计、去重和边界
- [x] 6.7 全量回归 14 个测试脚本 + 生产构建
- [x] 6.8 回填 AIMS Phase 3 台账与 UI 复核清单

---

## 三、 执行日志与验收凭证（Execution & Evidence Log）

- `[2026-10-22 22:20]` **T0 完成**：删除 `organizer.state`/`organizer.teamEdit` 两个动作的协议声明、host 分发 case、client 方法；组织者卡片改为「当场确认/审批/发布」语义，去掉远程拉状态。`npx vue-tsc --noEmit` 退出码 0。
- `[2026-10-22 22:35]` **T1 完成**：`publicSnapshotSchema` 加 `releaseNote`（默认空串，max 200）；`publishSnapshot` 透传；host 分发转发；成员端领取卡片下加 `n-alert` 寄语展示（`v-if` 判空隐藏）。新增 `scripts/test-release-note.ts` 8 条断言全过（Emoji、多行、超 200 字被 schema 拒、digest 随寄语变化、同内容 digest 稳定）。
- `[2026-10-22 22:50]` **T2 完成**：`TeamSummaryTab` pending 增强为 `{sub, prev}` 结构；「已修订 · 第 N 版」warning 角标；「查看改了什么」展开数量/金额/备注三项 diff。新增 `scripts/test-rev-badge.ts` 10 条断言全过。**过程中测试抓到一个真实 UI 缺陷**：旧版仍挂 submitted 时会与新版重复占位，已加去重过滤（同 submissionId 有更高 revision 在待审/已确认时，旧行不显示）。
- `[2026-10-22 23:05]` **T3 完成**：成员端「导入公共文件/导出我的报告」与主机端「导出资料文件」收入右上角「更多」`n-dropdown`；主界面只留扫码/分工/记账/发布四大高频按钮。
- `[2026-10-22 23:10]` **T3 构建修复**：`TeamSummaryTab.vue` 待审列表 `<div v-for>` 缺 `</div>`，vue-tsc 查不出、rolldown 构建报 `Element is missing end tag`；用 `@vue/compiler-sfc` 定位到 329 行后补闭合。`npm run build` 退出码 0。
- `[2026-10-22 23:12]` **T4 部分完成**：既有 7 脚本 + 新增 2 脚本共 9 个全部退出码 0；`npm run build` 退出码 0。真机 UI 验证被 MIUI `INSTALL_FAILED_USER_RESTRICTED` 拦截（需人工在手机上确认 USB 安装权限），待人工确认后补跑。

---

## 四、 遗留与阻塞

| 项 | 状态 | 说明 |
|---|---|---|
| 真机 UI 验证 | 🔴 阻塞 | MIUI 拦截 adb 安装（INSTALL_FAILED_USER_RESTRICTED）。需在手机上手动允许 USB 安装后，重装 debug 包跑 ui-verify |
| release 包 | ✅ 已装 | 当前手机上是 release 包（20:46 装的旧版，不含本轮改动） |
| git push | ⏸ 未执行 | 按 AIMS 铁律，收到人类明确 PUSH 指令前不推送 |

- `[2026-10-23 00:15]` **3.2 完成（11/11 全过）**：人工开启 MIUI USB 安装权限后，重装 debug 包，CDP 驱动 11 项断言全部通过：T0 远程收敛（无远程主机/刷新远程状态字样）、T1 发布按钮 + prompt 含「发布说明」、T2 待审卡片、T3 更多菜单（主机端 + 成员端）+ 头区无直出文件按钮、分工/成员页渲染。截图 scripts/out/aims-ui/。**过程中修复**：更多菜单原先挂在会话卡片（未开会话时不渲染），移到发布卡片（始终可见）；主发布按钮加发布说明 prompt（细节 A 主入口）；moreOptions 数组字面量断裂修复。
- `[2026-10-23 00:15]` **文档结构迁移**：按落地步骤 SOP 第二节，根目录挂载 AIMS.md / AIMSTODO.md / 00.最高技术纲领.md（原 aims/*.txt 复制重命名）；docs/archive/ 归档目录已建。
- `[2026-10-23]` **4.1 完成**：`teamClient.ts` 请求体改用基础 AAD 加密，响应改用绑定 `type/operationId` 的完整 AAD 解密，与 `teamHostService.ts` 对齐；`scripts/test-team-identity.ts` 新增请求/响应 AAD 回归断言，测试全过。
- `[2026-10-23]` **4.2/4.3 完成**：发布预览改用固定 `createdAt=0`，发布说明参与预览摘要；`publishSnapshot` 幂等摘要纳入 `releaseNote` 与预览摘要，重放返回 `created=false/replayed=true`。新增 `scripts/test-publish-preview.ts`，7 条断言全过；`scripts/test-release-note.ts` 10 条断言全过。
- `[2026-10-23]` **4.4–4.9 完成**：发布/回执/确认/退回/撤回操作号改为稳定值；成员端新增「我的上报」和修订入口，沿用 `submissionId`/`expenseReportId` 并递增 revision；自定义分摊改用 `yuanToFen` 并校验合计；报告文件导入收进「更多」；发布说明统一 500 字边界；文件读取失败改为显式人话错误；清理远程汇总措辞并更新 `TEAM_COLLAB_SPEC.md`。`scripts/test-revision.ts` 7 条断言全过，`npx vue-tsc --noEmit` 退出码 0。
- `[2026-10-23]` **4.10 完成**：9 个历史脚本 + `test-publish-preview` + `test-revision` 共 11 个脚本全部退出码 0；`npm run build`（含 `vue-tsc --noEmit`）退出码 0，Vite 产物构建成功。
- `[2026-10-23]` **4.11 完成**：`AIMS.md` P1-T1/T2/T3 回填为「进行中（待真机 UI 复核）」，P1-T4 回填为「已验收」；本文件新增人工验收清单。按用户此前要求，本轮未执行设备测试。
- `[2026-10-23]` **人工验收完成**：用户确认真机 UI 检测 ok。`AIMS.md` P1-T1/T2/T3 更新为「已验收」，Phase 1 进入可归档状态；未自动移动归档文件。
- `[2026-10-23]` **Phase 2 启动**：Phase 1 快照已归档到 `docs/archive/Phase_1_旅行收尾/`；`AIMS.md` 当前阶段切换为 `mod-daily`。
- `[2026-10-23]` **5.1–5.5 完成**：新增 `src/core/modRegistry.ts`、`src/mods/mod-daily/schema.ts`、`store.ts`、`DailyView.vue`；Dexie 升级 v3；`/daily` 接入路由、导航和设置模块开关。
- `[2026-10-23]` **5.6–5.7 完成**：`scripts/test-daily.ts` 当前 29 条断言、`scripts/test-mod-registry.ts` 6 条断言通过；Phase 2 完成时全部 13 个测试脚本退出码 0；`npm run build`（含 `vue-tsc`）退出码 0。
- `[2026-10-23]` **本地浏览器冒烟**：`/daily` 页面成功渲染；新增任务、自动保存备忘录、刷新恢复均通过；冒烟数据已清理。真机 UI 待用户复核。
- `[2026-10-23]` **Phase 2 UI 复核**：本地浏览器完成任务编辑/完成/删除、跨日期隔离、备忘与复盘刷新恢复、模块开关显隐验证，测试数据已清理；Phase 2 台账更新为已验收，Phase 3 启动。
- `[2026-10-23]` **Phase 3 启动**：登记 `finance` 模块；新增 `src/mods/mod-finance/` schema、store、统计函数和 `/finance` 页面；Dexie 升级 v4。
- `[2026-10-23]` **Phase 3 完成**：`test-finance` 21 条断言通过；全部 14 个测试脚本退出码 0；`npm run build` 通过；本地浏览器账房新增/编辑/删除和窄屏溢出修复验证通过，测试账目已清理。
- `[2026-10-23]` **Phase 3 UI 联动复核**：本地浏览器创建旅行测试花费并导入账房，验证「旅行导入」标记和重复导入禁用；旅行表内容保持不变。旅行卡片操作由 hover 改为常显，触屏可直接打开/导出/复制/删除；测试旅行和账目已清理。
- `[2026-10-23]` **v1.1.0 双端构建**：Android 资产已 `cap sync`，Debug/Release APK 构建成功；Android release 签名校验通过并安装到手机（versionCode 2、versionName 1.1.0）；Tauri Windows 安装包与 portable exe 构建成功，portable 已启动。

## 五、Phase 1 人工验收清单（已通过）

- [x] 团队主机发布带 500 字/Emoji/多行说明的快照，成员领取后顶部显示寄语，空说明不占空行
- [x] 成员修改已提交报告并重交，组织者待审列表出现「已修订」角标，展开可看到前后数量/金额/备注差异
- [x] 团队页主界面只保留高频操作，报告导入、公共文件导入和报告导出都从「更多」进入
- [x] 同一 WiFi 下完成一次主机—成员扫码连接、提交、领取和回执闭环
- [x] 锁屏、切后台、退出团队页后主机停止接入，业务数据仍保留

## 六、Phase 2 人工验收清单（已通过本地复核）

- [x] 侧边栏/底部导航出现「每日」，进入 `/daily` 页面正常
- [x] 新增任务、填写时间、勾选完成、编辑任务、删除任务均正常
- [x] 前后切换日期或选择日期后，任务、备忘和复盘数据互不串
- [x] 随手备忘停止输入后自动保存，刷新或重进页面仍能恢复
- [x] 三问复盘保存后重新打开仍能恢复，空内容不报错
- [x] 设置里关闭「日常规划」后入口隐藏，再开启后恢复
- [x] 手机窄屏下页面无横向溢出，按钮和输入框可正常操作

## 七、Phase 3 人工验收清单（待用户执行）

- [ ] 侧边栏/底部导航出现「账房」，`/finance` 页面正常
- [ ] 快速记账、编辑、删除、日期/分类筛选正常
- [ ] 月度合计、分类占比、近 7 日趋势与明细一致
- [ ] 导入旅行花费后显示「旅行导入」标记，重复导入被跳过
- [ ] 导入前后旅行账本内容不变
- [ ] 手机窄屏无横向溢出，金额输入和按钮可正常操作
- [ ] 页面不出现支付、转账、银行卡或金融 API 入口
