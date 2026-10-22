# AIMSTODO · 行囊当前执行任务流水

> **AI 执行守则**：
> - 状态符号约定：`[ ]` 待办 ｜ `[/]` 正在执行（全表全局仅限 1 项） ｜ `[x]` 已完成且通过验证 ｜ `[-]` 已取消/废弃
> - 严禁跳步：前一项未验证通过前，禁止将后续项标记为 `[/]`。
> - 交付纪律：每将一项标记为 `[x]`，必须在下方【执行日志】追加 1-2 行实测证据。

---

## 一、 当前进行中（Active WIP）

- **所属模块**：Phase 1 旅行模块收尾
- **当前目标**：Phase 1 全部完成，等待人类验收后归档
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
- [x] 1.4 边界测试：Emoji/多行/500 字截断/空值（scripts/test-release-note.ts）

### 阶段 2：UI 渲染与交互降噪
- [x] 2.1 组织者发布弹窗增加说明输入（prompt，限制 200 字，非必填）
- [x] 2.2 团长端待审列表「已修订」角标 + 展开前后数值对比（细节 B）
- [x] 2.3 降噪处理：`.team-public` / `.team-submit` 导入导出收进「更多」折叠菜单（细节 C）
- [x] 2.4 顺手修复：旧版报告重复占位（pending 去重）

### 阶段 3：全量回归防线
- [x] 3.1 运行既有 7 项回归测试 + 2 项新增测试，100+ 断言全绿
- [x] 3.2 真机 UI 验证（人工开启 USB 安装权限后通过）

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
