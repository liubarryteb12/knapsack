# 团队筹备与汇总：动工计划与验收要求

日期：2026-10-07  
目标：按 TEAM_COLLAB_SPEC.md 实现 Android 手机主机的分工—上报—清点—发布—分发闭环。  
本文件是实施计划，不是已完成记录；实际状态写 TEAM_COLLAB_LEDGER.md。规格是业务规则唯一事实源，本计划列施工与验证。

## 1. 开工要求

项目根目录：d:\00.AIagent\codespace\Knapsack。先读SPEC、本文、台账及适用项目指令，再读实际代码。

1. 执行git status --short，保护已有修改；核对依赖、Node/JDK/SDK、旧测试与Android入口。
2. 向用户简短说明采用的SPEC 1.2默认值：单Android权威主机、前台会话、人工确认、独立团队数据、文件兜底。范围/体验冲突先问；已明确的手机优先与分发范围不要重复问。
3. 无工具链/真机时如实登记；可完成领域及模拟验证，不能宣称真机功能已验收。
4. 先P0验证原生网络/JS事务ACK及身份契约，再正式实现UI。本轮文档AI没有替你实现功能。
5. 不自动commit/push、重置或清理；用户明确要求时才操作。
6. 开工回报：动手前先给用户一段说明，不要省略，也不要只说「开始实现」：
   - 采用的SPEC 1.2默认值逐条列出，不接受或需变更的项单独说明并等确认。
   - 工具链核验结果：Node、JDK、Android SDK、Gradle、Capacitor 是否可用，是否有 Android 真机；缺什么如实登记，不跳过也不假设已装。
   - 本次准备新增/修改的文件范围与 Dexie 版本计划。
   - 需用户确认的范围变更；没有则写「无」。
7. 每次会话结束更新 LEDGER 第 8 节交接字段；暂停也要留下唯一优先动作。

硬边界：不整份覆盖私人Trip，不把team字段塞入trip.v1，不把上报当确认，不在未持久化时ACK，不把领取当已读，不信客户端自报身份，不以共享密钥授权成员，不外发私人资料/凭证，不加云后台，不顺手改无关模块。

## 2. 现有代码阅读地图

| 入口 | 当前作用与陷阱 |
| --- | --- |
| [trip.ts](file:///d:/00.AIagent/codespace/Knapsack/src/schema/trip.ts) | trip.v1，未知字段剥除；行李只有名称/packed |
| [index.ts](file:///d:/00.AIagent/codespace/Knapsack/src/db/index.ts) | Dexie v1只有trips；升级保留旧数据 |
| [trips.ts](file:///d:/00.AIagent/codespace/Knapsack/src/stores/trips.ts) | 整对象put，asNew重建ID |
| [tripFile.ts](file:///d:/00.AIagent/codespace/Knapsack/src/utils/tripFile.ts) | 完整.trip，不用于公共局部数据 |
| [regenerateIds.ts](file:///d:/00.AIagent/codespace/Knapsack/src/utils/regenerateIds.ts) | 私人副本重挂ID，不用于团队稳定身份 |
| [money.ts](file:///d:/00.AIagent/codespace/Knapsack/src/utils/money.ts) | 元/分转换可复用 |
| [settle.ts](file:///d:/00.AIagent/codespace/Knapsack/src/utils/settle.ts) | 纯结算可复用，调用前验证引用/分摊 |
| [TripDetailView.vue](file:///d:/00.AIagent/codespace/Knapsack/src/views/TripDetailView.vue) | 团队筹备入口候选 |
| [TripsView.vue](file:///d:/00.AIagent/codespace/Knapsack/src/views/TripsView.vue) | 全局加入入口候选，成员无须私人Trip |
| [PackingTab.vue](file:///d:/00.AIagent/codespace/Knapsack/src/components/PackingTab.vue) | 保留私人行李语义 |
| [LanSessionModal.vue](file:///d:/00.AIagent/codespace/Knapsack/src/components/LanSessionModal.vue) | 旧整份覆盖流程，不直接用于团队汇总 |
| [lanSessionProtocol.ts](file:///d:/00.AIagent/codespace/Knapsack/src/utils/lanSessionProtocol.ts) | knapsack-session/1，可按需复用编码/加密基础方法 |
| [lanSessionHost.ts](file:///d:/00.AIagent/codespace/Knapsack/src/utils/lanSessionHost.ts) | Tauri封装，Android不能直接调用 |
| [session.rs](file:///d:/00.AIagent/codespace/Knapsack/src-tauri/src/session.rs) | 旧Rust ACK早于JS落库，不复用该成功语义 |
| [MainActivity.java](file:///d:/00.AIagent/codespace/Knapsack/android/app/src/main/java/com/liubarryteb12/knapsack/MainActivity.java) | 空BridgeActivity，注册原生插件入口 |
| [AndroidManifest.xml](file:///d:/00.AIagent/codespace/Knapsack/android/app/src/main/AndroidManifest.xml) | 网络/相机/明文，按最小需要权限 |
| [capacitor.config.ts](file:///d:/00.AIagent/codespace/Knapsack/capacitor.config.ts) | cleartext/mixed content不保证完整网络可达 |
| [build.gradle](file:///d:/00.AIagent/codespace/Knapsack/android/app/build.gradle) | 原生依赖/测试/打包 |
| [variables.gradle](file:///d:/00.AIagent/codespace/Knapsack/android/variables.gradle) | min24、compile/target36 |
| [test-tripfile.ts](file:///d:/00.AIagent/codespace/Knapsack/scripts/test-tripfile.ts) | 文件/ID回归 |
| [test-lansession.ts](file:///d:/00.AIagent/codespace/Knapsack/scripts/test-lansession.ts) | 加密/二维码/KAT回归 |
| [test-settle.ts](file:///d:/00.AIagent/codespace/Knapsack/scripts/test-settle.ts) | 金额/分摊回归 |

新文件按模型、领域/持久化、协议、原生适配、UI职责确有需要才创建；P0/P1固定名称写台账，不堆杂物helpers或引入大型框架。

## 3. 施工阶段与退出条件

依赖链：P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7。契约冻结后，P1领域测试与P2原生传输局部实现可并行，不得让后序代理猜协议。

### P0 手机最小技术验证与契约冻结

- 核验工具链，选轻量成熟HTTP库并记录版本、维护、许可证、最低SDK。
- Android前台监听，成员WebView经扫码/手动连接收发最小消息；验证有效IPv4/端口、CORS/OPTIONS、混合内容和实际局域网访问限制。CORS不是授权。
- 实测native request→JS handler→模拟延迟保存→completeRequest→HTTP response，handler缺席/失败/超时不能成功ACK。
- 同Wi-Fi和手机热点各测，前台退出/锁屏/网络变化要清理；缺真机记录待验。
- 冻结team/schema、身份配对、同批逻辑键、发布/回执事务、文件格式及失败恢复语义。
- 核验平台密码与Web Crypto互操作。P-256/HKDF若采用须确定编码、salt/info、方向密钥、nonce/AAD/测试向量，不自创密码算法。
- 确定密码操作在JS或原生哪层，HTTP业务响应必须加密；对机密存储说明威胁边界，优先系统安全存储。与密文一起放localStorage的KEK不抵抗完整存储窃取。

完成标准：最小收发及失败ACK有证据，契约无未决冲突。无真机P0可标待验证，不能据此将P2/P7标全部完成。

### P1 模型、数据库、纯领域

- 独立team类型/schema与表，Dexie升级保留trips，重启恢复业务数据/outbox。
- 权限、报告revision、taskRevision过时规则、确认/退回/撤回、同阶段/节点/批次唯一当前来源。
- 费用作者与payerId分开，费用来源唯一，引用/分摊验证，团队结算不双写私人账本。
- 幂等业务键不含临时session；同ID异载荷冲突；并发事务与sourceDraftRevision发布检查。
- 公共白名单纯投影；原子发布版本/快照/最新指针/日志/幂等结果；UI统一调用小型领域动作。

完成标准：A01–A13自动化通过，旧升级/往返正常，发布中途故障与修订费用有断言。

### P2 Android服务与身份协议

- 生产化start/stop/status/completeRequest；handler和数据就绪后监听，原生等待JS结果而非事件发出即ACK。
- 请求上限/并发/超时/生命周期/网络变更清理。
- 私有配对、审批/绑定/撤销、首次凭证保存失败人工恢复；服务端授权、会话/AAD绑定。
- 原生与TS用小transport接口；浏览器无主机能力明确提示。
- 新会话重新认证后可重试原业务operationId，旧密文不能接受。
- 第一版不要求Windows新team主机；旧桌面会话保留，新增桌面主机属范围变更。

完成标准：A14–A20协议/原生证据齐全，失败/丢ACK、旧session、身份重绑定均受测。

### P3 分工、首次领取、成员上报

- 主机名册/物资需求/allocation/节点、初始分工第1版发布与审批二维码。
- 全局加入入口、稳定memberId、公共任务/我的任务、草稿/outbox离线保存。
- 同一人买/带也分阶段；清点必须节点；费用可他人垫付，来源作者由凭证确定。
- 上传展示已接收和待审核区别；任务新版提示而不丢旧草稿。

完成标准：A21–A24与三人首次加入/离线/断线样例，审批响应丢失可恢复且无重复身份。

### P4 清点、审核、总表、正式费用

- 待审核、退回原因、修订比较、过时核对；主机确认才更新事实。
- 节点/阶段/批次唯一当前量，重清点明确替换；未清点标未知，不虚构确定缺口。
- 按节点/物资/成员总表，突出无人负责、未上报、缺口/多出。
- 费用确认/修订/撤回及业务日志，失败保留草稿。

完成标准：24瓶需求，买24/带24/现场20时现场缺4，不累计68/72；36元只记一次，修订待核对不自动入账。

### P5 发布、领取、变化摘要、回执

- 发布预览revision检查，不变历史；发布动作重试返回原版。
- 公共快照/当前指针/待回执outbox同事务保存，成功后补传；主机持久回执ACK后清理。
- 主机领取版本单调增加，旧回执不降级；任务确认若做与领取独立。
- 公共更新不污染私人数据/outbox，离线只报本机版本。

完成标准：A25–A30，保存与回执创建间无崩溃窗口；主机重启版本/回执恢复。

### P6 文件兜底、兼容、错误体验

- 公共/报告独立格式，白名单、导入预览、版本核对、幂等。
- 文件报告人工核对作者、绑定后同领域审核；不伪造在线身份/回执。
- Android真正分享/保存/选择往返；网络隔离/权限/超限诊断与可操作错误。
- 旧.trip及旧局域网回归。

完成标准：A31–A35，文件/网络都不会静默丢字段或私人数据。

### P7 回归与真机交付

- 全矩阵、构建、旧脚本、隐私payload/导出检查。
- 至少一Android主机＋两成员设备跑下一节现场样例；缺设备标未验，不用单浏览器mock代替。
- 记录设备/Android/WebView/网络、步骤/观察，提供产物真实位置、未过项与前台限制。
- 必要用户文档只更新本功能；不宣称未验后台/热点能力。

完成标准：阻断项有通过证据；未做项解释；工作区保护，无未经要求的提交/推送。

## 4. 验收矩阵

本轮文档AI未运行，下表是实施要求。每项结果记录LEDGER证据ID。

| ID | 场景与必须结果 | 级别 |
| --- | --- | --- |
| A01 | 旧库升级私人行程/行李/费用/备忘不变，旧.trip往返 | 阻断 |
| A02 | 首次/重复领取稳定team/member/task标识，不asNew重建或重复团队 | 阻断 |
| A03 | 公共序列化没有私人notes/packing/expenses、凭证/密钥/队列 | 阻断 |
| A04 | 公共更新前后私人Trip与待上传草稿完全不变 | 阻断 |
| A05 | 同批买24/带24/清点20分阶段不累加；同人兼买带与分人均通过 | 阻断 |
| A06 | 同节点重清点20→22替换为22；不同submissionId竞争同逻辑键须明确替换而非42 | 阻断 |
| A07 | 两节点各20不加成40；未清点批次显示待核对，非确定缺口 | 阻断 |
| A08 | 旧taskRevision报告待核对，不更新当前确认量 | 阻断 |
| A09 | 报告幂等/乱序/修订；费用36→40待审仍36、确认后一笔40、旧发布36、私人账本不变 | 阻断 |
| A10 | 悬空/重复成员、shares错长、custom总额错拒绝，不产生坏账 | 阻断 |
| A11 | 一费关联多批次只算一次；自带无费也可确认 | 阻断 |
| A12 | 并发确认/发布不丢更新；过时预览拒绝；发布事务中途异常保持原版无悬空指针 | 阻断 |
| A13 | 发布后编辑旧快照不变；发布提交成功但响应丢失，同发布operationId重试返回原版不再增版 | 阻断 |
| A14 | GCM篡改/错key/AAD/路径失败，不处理，不返回成功ACK | 阻断 |
| A15 | 冒充/越权拒绝；别人不能复用expenseReportId修订；作者可上报他人实际付款后由主机确认 | 阻断 |
| A16 | 旧session密文/跨team拒绝，握手/session绑定有效 | 阻断 |
| A17 | 主机落库/JS缺席/超时失败ACK，事件发送不算接收 | 阻断 |
| A18 | 落库成功丢ACK，主机重启新会话重新认证加密同operationId返回原结果，无重复 | 阻断 |
| A19 | 超限/并发/停止受控失败，句柄释放不无限排队 | 阻断 |
| A20 | 密码互操作向量、逐成员凭证隔离、重绑定撤销旧设备均通过 | 阻断 |
| A21 | 无私人Trip首次加入；审批响应丢失/凭证保存失败/双方重启人工恢复原memberId，不重复名册 | 阻断 |
| A22 | 草稿/outbox杀进程恢复；重连不用旧连接密钥 | 阻断 |
| A23 | 接收/审核区别；新修订不默默替已确认事实 | 阻断 |
| A24 | 采购/携带/付款/报告作者可分离，任务按正确身份显示 | 阻断 |
| A25 | 领取事务失败不发回执，旧快照/草稿保留；快照/指针/回执outbox原子提交 | 阻断 |
| A26 | 保存后传回执前崩溃仍有待补；主机回执落库ACK丢失重复无副作用，主机不误报 | 阻断 |
| A27 | 重领/旧版不重复降级；同ID异内容冲突；第2版回执晚于第3版不降主机状态 | 阻断 |
| A28 | 主机重启版本/报告/审核/回执/历史保留 | 阻断 |
| A29 | 领取与任务确认独立，保存不等于同意 | 若实现任务确认则阻断 |
| A30 | 离线只显示本地版本/最后查询，不假装知道最新 | 阻断 |
| A31 | 公共文件无私人秘密，预览来源/版本，只更独立团队视图 | 阻断 |
| A32 | 报告文件去重/冲突、人工来源核对，不按自报memberId自动通过 | 阻断 |
| A33 | 旧功能正常，未知协议/schema拒绝，不静默丢字段 | 阻断 |
| A34 | Android保存/分享/选择真实往返，不只Blob演示 | 阻断 |
| A35 | 手机小屏/深浅主题可用，错误不丢草稿，危险动作确认 | 阻断 |

## 5. 真机现场样例

组织者甲主机、采购者乙、携带者丙，推荐三设备。模拟角色标明模拟。

1. 私人旅行放辨识备忘PRIVATE-NOTE-DO-NOT-SHARE及私人行李项；创建团队，选择公共日程，发第1版。
2. 水24瓶，一个allocation由乙买/丙带，甲清点集合节点。
3. 两成员扫码由甲绑定、领第1版，主机显示领取回执。另测审批后响应丢失再人工恢复，memberId不变。
4. 乙离线报告买24/36元，实际付款人设丙；丙报告带24。
5. 乙上传断网重试，主机一条报告/一笔待审36元；丙上报不能累计成48。
6. 甲确认清点20，显示缺4，确认费用后团队账本36，私人账本不变。
7. 发第2版，乙领取，丙离线；显示乙第2版、丙第1版待更新。
8. 成员离线看公共总表/费用，私人辨识串及未上传草稿不变。
9. 丙保存第2版后阻断回执并杀进程，重启待补回执仍在，甲未误报；恢复补传。
10. 乙费用修订40，主机待审仍36、确认后一笔40，第2版快照仍36。甲新建补缺4瓶批次给丙，再发第3版，避免复用原allocation重复实物。
11. 第2版回执晚于第3版到达不降级；主机锁屏/退出停止，前台重开会话重新认证重试，旧密文无效、原业务不重复。
12. 换手机热点重测；不可达记录设备/网络限制，验证公共结果文件与报告文件兜底。
13. 检查公共文件及解密公共payload无私人辨识串或凭证；注入发布事务中途失败/提交后丢响应，两类恢复符合A12/A13。

## 6. 验证命令与证据

以当前配置为准。以下旧命令存在，不代表文档AI执行过。根目录PowerShell：

```powershell
npm run build
npx tsx scripts/test-settle.ts
npx tsx scripts/test-tripfile.ts
npx tsx scripts/test-lansession.ts
```

src-tauri目录：

```powershell
cargo test --lib
```

根目录构建/同步Android：

```powershell
npm run build
npx cap sync android
```

android目录：

```powershell
.\gradlew.bat testDebugUnitTest assembleDebug
```

有设备且已新增instrumentation测试时在android：

```powershell
.\gradlew.bat connectedDebugAndroidTest
```

新增team领域/协议/数据库测试命令P1/P2固定并登记。可沿用tsx；事务测试需fake-indexeddb等依赖按必要性说明，不强制大型框架。纯函数不代替数据库事务/原生网络/真机。

证据含命令、cwd、时间、退出码、验收ID；手测含设备/Android/WebView/网络、步骤、观察。不能执行写原因，不写通过。APK给真实产物位置，打包失败不虚构产物。

## 7. 并行协作、台账、交付

契约后可按领域/原生/UI与测试分工，固定文件归属；公共schema/协议一位负责人整合，后序不猜接口。阶段结束立即更新台账实际改动、证据、风险、下一步，暂停时留会话交接。

最终交付：需求覆盖与真实限制、变更文件、数据库升级/格式兼容、自动化和真机证据、未过/未验项、真实产物位置、旧功能回归、无秘密导出样例、台账。用户未要求则不提交/推送。

## 8. 交接入口与首次会话清单

三份根目录文档是事实源，可单独开工，不需要上一 AI 的对话记录：

1. [TEAM_COLLAB_SPEC.md](file:///d:/00.AIagent/codespace/Knapsack/TEAM_COLLAB_SPEC.md)：业务规则唯一事实源，冲突以它为准。
2. [TEAM_COLLAB_PLAN.md](file:///d:/00.AIagent/codespace/Knapsack/TEAM_COLLAB_PLAN.md)：本文件，工序与验收。
3. [TEAM_COLLAB_LEDGER.md](file:///d:/00.AIagent/codespace/Knapsack/TEAM_COLLAB_LEDGER.md)：真实进度、决策、风险、证据。

### 8.1 可直接发给实施 AI 的指令

```text
按 d:\00.AIagent\codespace\Knapsack 项目中的 TEAM_COLLAB_SPEC.md、TEAM_COLLAB_PLAN.md、TEAM_COLLAB_LEDGER.md 开工。
先执行 git status --short 核对工作区，再按 PLAN 第 1 节回报：采用的 SPEC 1.2 默认值、工具链与真机核验结果、拟改动文件与 Dexie 版本计划、需确认的范围变更。
然后从 P0 手机主机技术验证开始：Android 前台本地 HTTP、nativeRequestId → JS handler → 等待落库后 completeRequest 的延迟 ACK、身份配对契约，并冻结 team 协议/schema。
每阶段更新台账，保留命令与真机证据，未验证项如实注明，不要宣称未执行的验收通过。不要自动 commit/push。
```

### 8.2 首次会话必做清单

按顺序完成，缺项写台账原因，不要跳过后声称已做：

| 序 | 动作 | 完成判据 |
| --- | --- | --- |
| 1 | 读 SPEC / PLAN / LEDGER | 三份全读，不以临时索引代替 |
| 2 | `git status --short` | 记录工作区状态，保护既有修改 |
| 3 | 核对第 2 节代码地图涉及文件的当前实际内容 | 至少打开 schema/db/stores/协议/原生入口确认与文档一致 |
| 4 | 工具链核验（Node、JDK、SDK、Gradle、Capacitor、真机） | 逐项记录版本或缺失 |
| 5 | 向用户回报第 1 节第 6 条要求的四项内容 | 用户无异议后再改代码 |
| 6 | P0 最小收发与失败 ACK 验证 | 有命令/真机证据，登记 E 编号 |
| 7 | 冻结契约并新增 D13 起决策记录 | 协议/schema/依赖/表结构/文件格式写进台账 |

### 8.3 暂停或换人时的交接字段

与 LEDGER 第 8 节相同：当前工序与最后完成的动作、已改文件与工作区状态、证据 ID 与失败项、协议/schema/数据库版本与已选依赖、待用户决策项、下一步唯一优先动作。

### 8.4 建议 skills

仅在环境提供时调用：brainstorming（默认值冲突或新架构决策）、implement（按规格施工）、tdd（不变量/幂等/事务/隐私投影先测）、diagnosing-bugs（联调真实故障）、ui-ux-pro-max 与 better-accessibility（P3 及之后做团队页面时）、handoff（会话结束留台账）。不要安装新 skill 或改全局 agent 配置。
