# 团队筹备与汇总：实施台账

文档日期：2026-10-07（2026-10-08 更新）  
当前阶段：P0/P1 已完成；P2–P5 代码与单元/真机链路测试完成，待真机端到端验收；P6 文件兜底代码完成，真机保存/分享通过；P7 单机验收已执行（A22/A28/A30/A35/E19 通过，A34 已定位根因并修复，待最终包复验）；2026-10-21 另完成 R15 清理与「闪退」根因修复（WebView 渲染进程死亡自愈 + 主机插件线程安全），三设备现场样例仍未做。  
约定：规格看 TEAM_COLLAB_SPEC.md，施工和验收看 TEAM_COLLAB_PLAN.md，本文件只记录实际状态、决策、证据和问题。

## 1. 当前基线

| 项目 | 状态 |
| --- | --- |
| 产品需求 | 已记录：亲友组团、物资分工/采购/携带/清点/费用、手机优先主机、汇总结果分发 |
| 分发范围 | 用户已选：团队公共资料＋我的任务 |
| 文档 | SPEC、PLAN、LEDGER 三份根目录文档自包含；PLAN 第 8 节为交接入口 |
| 应用代码 | 已实现团队领域层/持久化/原生插件/UI/文件兜底；旧 trip 与局域网功能未改语义 |
| 依赖/数据库 | 新增 @capacitor/filesystem@8.1.4、@capacitor/share@8.0.3；Dexie 升 v2（新增 5 张团队表，trips 不动） |
| 构建/测试/真机联调 | `npm run build` 通过；team 系列 4 个脚本全过；旧回归 3 个脚本全过；真机链路与密码互操作、文件往返已通过；真机 UI 端到端与多设备样例未做 |
| git | 2026-10-08 工作区含大量未跟踪新文件与已改文件；未 commit、未 push |
| 第一版技术建议 | 单 Android 主机、前台会话、独立 team 数据、人工确认、版本发布；已在代码中落地 |
| Android 工具链 | Capacitor 8 需 Java 21；系统 JDK 17 与 Android Studio jbr 25 均不可用（Gradle 8.14.3 不支持 25），改用本地 OpenJDK 21.0.2（`.jdk21/`，已 gitignore） |


## 2. 施工状态

状态枚举：未开始 / 进行中 / 待验证 / 已完成 / 阻碍。只有退出条件有证据才能标已完成。

| 工序 | 依赖 | 状态 | 负责人 | 实际改动/结果 | 证据 | 下一动作 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 手机技术验证/契约 | 无 | 已完成 | 实施AI | 冻结 knapsack-team/1 协议、team.v1 schema、Dexie v2 表结构；实现并注册 TeamHost 原生插件；真机链路与密码互操作通过 | E03、E07–E11 | 无（已达成退出条件） |
| P1 模型/持久化/领域 | P0契约 | 已完成 | 实施AI | team 领域函数、schema、幂等/发布/领取事务与 fake-indexeddb 测试 | E03–E05 | 无 |
| P2 Android服务/身份协议 | P0、P1 | 待验证 | 实施AI | ECDH+HKDF 会话密钥、AES-GCM 信封+AAD、逐成员 HMAC 凭证、审批/恢复配对、延迟 ACK；单元与真机密码向量通过 | E09–E11 | 真机端到端「成员扫码加入并领取」手测（P7） |
| P3 分工/成员领取上报 | P1、P2 | 待验证 | 实施AI | 团队列表/详情、分工设置、成员连接/领取/上报 UI；离线 outbox 逻辑有事务测试 | E04、E12 | 真机 UI 手测（P7） |
| P4 清点/审核/正式费用 | P3 | 待验证 | 实施AI | 待审核确认/退回、缺口总表（节点隔离、未清点标待核对）、费用确认入团队账本（36→40 一笔） | E03、E04 | 真机 UI 手测（P7） |
| P5 发布/分发/回执 | P4 | 待验证 | 实施AI | 不可变发布+版本幂等、分发状态（从幂等表读回执）、领取事务（快照+指针+回执同事务） | E03、E04 | 真机端到端（P7） |
| P6 文件/兼容/错误体验 | P5 | 进行中 | 实施AI | 公共/报告独立文件格式、导入预览与人工来源绑定、真实 Filesystem+Share 保存/分享；系统选择往返与旧功能真机回归待做 | E13–E18 | 手测系统「选择文件」往返与旧 trip/局域网真机回归（A34/A35） |
| P7 回归/真机/交付 | P0–P6 | 进行中 | 未分配 | 2026-10-22 完成一轮代码优化与回归（逻辑键唯一性、A08 stale、金额纪律、死代码清理），单测与构建全过；真机端到端仍未做 | E25、E26 | 三设备现场样例与全部真机证据 |

## 3. 决策台账

「已确认」只用于用户明确决定；「建议默认」不伪装成用户批准。实施AI在开工说明中确认接受默认或提出变更。

| ID | 决策 | 状态/来源 | 原因与影响 |
| --- | --- | --- | --- |
| D01 | 产品面向亲友自发组团 | 用户明确 | 不扩成旅行社后台 |
| D02 | 手机主机优先 | 用户明确选择 | Android原生HTTP能力必须新增 |
| D03 | 分发公共资料＋我的任务 | 用户明确选择 | 私人行李/备忘/草稿隔离 |
| D04 | 分工→上报→清点→发布→领取闭环 | 用户目标＋文档细化 | 汇总后必须分发，不只单向上传 |
| D05 | 第一版单权威Android主机 | 建议默认 | 不做多主机冲突或移交 |
| D06 | 前台会话；后台/锁屏停止接入 | 建议默认 | 避免隐含保活承诺；现场持续锁屏收集需用户另行确认 |
| D07 | 独立team协议/存储，不改trip.v1协作语义 | 建议默认＋代码风险 | 旧schema丢未知字段、旧同步整份覆盖 |
| D08 | 组织者本机确认/发布，清点负责人可上报 | 建议默认 | 无远程审批复杂权限；任务职责仍可分配 |
| D09 | 同批次买/带/清点分别记录 | 业务正确性要求 | 不重复累加同一实物 |
| D10 | 正式费用仅一次计入团队账本 | 建议默认＋金额正确性 | 不自动双写私人费用，关联多任务不重复累计 |
| D11 | 平台密码能力＋逐成员凭证通道 | 建议技术默认，P0核验 | 公共二维码不能授权冒充任意成员；可等价替换并记录 |
| D12 | 公共文件/报告文件兜底，人工核对来源 | 建议默认 | 文件来源不冒充在线身份认证 |

| D13 | 独立团队协议与文件格式：`knapsack-team/1`、`team.v1`、`team-publication.v1`、`team-submission.v1`，扩展名 `.team-public`/`.team-submit` | 实现选择（建议默认） | 不复用旧 trip.v1/旧 session；未知 format 明确拒绝 |
| D14 | Dexie 升到 v2，新增 teamState/teamPublications/teamOutbox/teamIdempotency/teamLink 五表，`trips` 原样保留 | 实现选择（建议默认） | 旧库升级不丢私人行程（A01） |
| D15 | 主机长期密钥 credentialSecret 只存 TeamState（绝不下发/不进公共快照）；逐成员凭证 = HMAC-SHA256(secret, `teamId|memberId|deviceId`) | 实现选择（D11 落地） | 共享二维码不能授权冒充任意成员 |
| D16 | 新增依赖 @capacitor/filesystem@8.1.4、@capacitor/share@8.0.3 做真实保存/分享；web 端兜底 Blob 下载 | 实现选择（A34 要求） | 手机端文件真实落盘并可交给系统分享，不只是 Blob 演示 |
| D17 | 文件兜底导入公共快照时 `queueReceipt=false`，不产生回执 | 实现选择 | 文件不证明在线身份，不能凭空产生回执 |
| D18 | Android 构建改用本地 OpenJDK 21.0.2（`.jdk21/`，已 gitignore） | 实现选择（工具链） | Capacitor 8 需 Java 21；jbr 25 与 Gradle 8.14.3 不兼容 |
| D19 | WebView 渲染进程死亡按「重建 Activity + 恢复 hash 路由」自愈：`onRenderProcessGone` 必须 **return true**（return false 会被系统杀进程），**不 reload 已报废的 WebView**；同进程重建上限 3 次、2s 冷却（冷却期内改为延迟重建而非丢弃）、恢复后稳定 60s 计数归零 | 实现选择（R16 处置） | reload 死 WebView 只会再次白屏；重建 Activity 让 Capacitor 重新创建 WebView 与桥。用户在白屏后自动回到原页面才算「自愈」 |
| D20 | Dexie 写入前统一 `toPlain()`（JSON 往返）消除 Vue 响应式 Proxy | 实现选择（A34 修复） | IndexedDB 走 structured clone，**不接受 Proxy**；视图层把解析结果放进 ref/reactive 后再传给持久层必然抛 `DataCloneError`。约定：这些入参是 schema 校验过的纯 JSON，不得含 Date/Map/Set |
| D21 | P7 单机验收自动化：测试文件由 **PC 侧 Node 生成 → adb push 到 /sdcard/Download → 真机 DocumentsUI 点选**（`scripts/p7-a34-picker.ts`）；CDP 拦截 + `DOM.setFileInputFiles` 仅作退路 | 实现选择（用户要求：测试文件在电脑上写好再给手机测） | 手机端不需要手写/手工建文件，且走的是用户真实路径（系统选择器 + content:// 读取），把原本「需人工点选」的 A34 变成可自动验收 |

后续实现选择（HTTP 依赖、测试命令等）继续按 D13 起的格式新增。

决策新增格式：ID、日期、决定者、受影响规格段落、备选方案、选择原因、验收项。范围变化须由用户确认并更新SPEC，不只记在代码中。

## 4. 风险与阻碍

| ID | 事实/风险 | 优先级 | 处理要求 | 当前状态 |
| --- | --- | --- | --- | --- |
| R01 | Android MainActivity暂无本地主机插件 | 阻断 | P0/P2真机链路验证 | 已关闭（TeamHostPlugin 实现并注册，E08/E09） |
| R02 | 旧协议整份Trip覆盖和asNew重建ID | 阻断 | 新团队协议/稳定标识，保留旧功能 | 已关闭（独立 team 协议；旧回归 E14） |
| R03 | 旧Rust emit事件后即ACK，不等待JS写库 | 阻断 | 新原生请求由JS处理完成后响应 | 已关闭（延迟 ACK，handler 缺席→504，E09） |
| R04 | 共享AES密钥不代表成员身份 | 阻断 | 私有配对/主机绑定/服务端授权 | 已关闭（ECDH 每成员独立密钥＋HMAC 凭证，E10/E11） |
| R05 | 同批物资多个角色重复统计 | 阻断 | allocation稳定标识＋分阶段计数 | 已关闭（E03/E04） |
| R06 | 断线、重复/乱序修订重复计账 | 阻断 | operationId幂等＋revision检查＋来源费用唯一 | 已关闭（E03/E04） |
| R07 | 私人资料被公共导出或覆盖 | 阻断 | 白名单投影与独立存储，字段不变断言 | 已关闭（公共文件白名单与无凭证断言，E13） |
| R08 | 旧Zod普通object剥除团队未知字段 | 阻断 | 独立文件/schema/protocol版本，未知明确拒绝 | 已关闭（未知 format 拒绝，E13/E14） |
| R09 | Wi-Fi隔离、热点路由、代理网卡 | 高 | 真机测试＋诊断＋文件兜底 | 未验证（P7 多设备/热点） |
| R10 | 锁屏/后台导致JS和服务生命周期不一致 | 高 | 默认前台会话，原生停止/清理，连接失效提示 | 未验证（P7 手测） |
| R11 | 公共领取完成但回执丢失 | 高 | 本地快照/指针/回执outbox同事务保存后发回执，待补传，主机不误报 | 已关闭（E04） |
| R12 | 原生依赖、工具链、目标WebView密码能力 | 高 | P0实测；无工具链/设备如实登记 | 部分关闭：工具链已核验（需 JDK 21，D18）；WebView 密码能力 E10 通过；其余真机能力随 P7 |
| R13 | 多版本费用/节点确认和发布并发 | 高 | 事务、草稿revision、不变历史 | 已关闭（E04） |
| R14 | Android文件下载不落到可见文件 | 高 | 实际分享/保存和选择往返 | 部分关闭：保存/分享真机通过（E18）；系统选择往返待手测 |
| R15 | android 工程存在重复的原生插件实现：根包 TeamHostPlugin.java（已注册、已验证）与未引用的 teamhost/ 包（基于 NanoHTTPD，另有 nanohttpd 依赖） | 中 | 确认无人引用后清理，避免下次接手误改 | 已关闭（用户授权删除；teamhost/ 目录与 nanohttpd 依赖已删，重建装机通过，E20） |
| R16 | 「闪退」根因：内存压力下（PSS ≈200MB，打开系统分享面板时）WebView **渲染进程**被系统杀掉（`E/chromium aw_browser_terminator.cc(156) Renderer process crash detected (code -1)`），应用进程存活但 WebView 报废 → 白屏，用户感知为闪退；Capacitor 默认 `BridgeWebViewClient.onRenderProcessGone` 无 listener 时 return false，不做兜底 | 高 | 渲染进程死亡必须自愈（重建 Activity + 恢复路由）；同时降低峰值内存 | 未关闭：自愈已实现并实测（E23）；2026-10-22 JS 侧降载（E28：缺口表 22x、列表投影 -93%）经真机 A/B 复测（E29）**对 PSS 无显著影响**（-1.3%，噪声内）。说明 PSS 大头是 WebView 引擎与原生库，JS 堆占比极小（实测 200 旅行列表 0.1MB、大团队快照 2.7MB）。下一步需转向原生侧（WebView 版本/硬件加速/进程模型）或接受现状靠自愈兜底 |
| R17 | 真机 WebView 版本 116.0.5845.92（2023 年内核），远低于 Capacitor 8 文档建议的 140 分界；老内核内存管理与兼容性风险不可控 | 中 | 登记环境差异；升级系统 WebView 后复测；代码侧不依赖新内核特性 | 未处理（环境限制，非本仓库可修） |

风险关闭需填写修复位置和证据ID；不能仅因写了规格就关闭。

## 5. 验收执行记录

状态枚举：未执行 / 通过 / 失败 / 无法执行 / 不适用。定义在PLAN矩阵，下面只登记结果。

| 验收ID | 状态 | 证据ID | 备注 |
| --- | --- | --- | --- |
| A01 | 通过 | E04 | 旧数据库升级，trip 保留 |
| A02 | 通过 | E11 | 稳定加入身份；恢复配对保留 memberId（真机端到端留 P7） |
| A03 | 通过 | E03、E13 | 公共序列化隐私白名单 |
| A04 | 通过 | E04 | 私人数据/草稿不变（事务与旧库断言） |
| A05 | 通过 | E03 | 同批次分阶段数量不累加 |
| A06 | 通过 | E03 | 重清点/同逻辑键来源替换 |
| A07 | 通过 | E03 | 节点隔离、未清点标待核对 |
| A08 | 通过 | E03、E25 | 旧任务版本报告（2026-10-22 补实现 + 回归测试，见 E25） |
| A09 | 通过 | E03、E04 | 幂等/乱序/修订与费用 36→40 一笔 |
| A10 | 通过 | E03、E04 | 成员/金额校验 |
| A11 | 通过 | E04 | 多任务费用只计一次 |
| A12 | 通过 | E04 | 并发确认/发布及发布事务失败回滚 |
| A13 | 通过 | E04 | 不变历史/发布响应丢失幂等重试 |
| A14 | 通过 | E10、E11 | 真机 AAD/篡改拒绝，不返回成功 ACK |
| A15 | 通过 | E11 | 越权/费用来源作者权限 |
| A16 | 通过 | E10、E11 | 旧会话密文/跨团队拒绝、AAD 绑定 |
| A17 | 通过 | E09 | 主机失败 ACK（handler 缺席→504） |
| A18 | 通过 | E04、E11 | 落库成功丢 ACK 后幂等重试返回原结果 |
| A19 | 通过 | E09 | 超时/停止受控失败 |
| A20 | 通过 | E10、E11 | 密码互操作/重绑定撤销旧设备 |
| A21 | 通过 | E11 | 审批响应丢失/凭证保存失败人工恢复原身份 |
| A22 | 未执行 | 无 | 草稿/outbox 杀进程恢复（真机项，P7） |
| A23 | 通过 | E03、E04 | 接收/审核区别、修订不默默覆盖 |
| A24 | 通过 | E03、E04 | 责任/付款/报告作者分离 |
| A25 | 通过 | E04 | 快照/指针/回执 outbox 原子提交 |
| A26 | 通过 | E04 | 崩溃后待补回执/回执 ACK 丢失重试 |
| A27 | 通过 | E04 | 重复/旧版本不降级、异内容冲突 |
| A28 | 未执行 | 无 | 主机重启版本/报告/审核/回执保留（真机项，P7） |
| A29 | 不适用 | 无 | 未实现独立任务确认功能 |
| A30 | 未执行 | 无 | 离线只显示本地版本（UI 已如此，未手测，P7） |
| A31 | 通过 | E13 | 公共文件无私人秘密、预览来源/版本、只更独立团队视图 |
| A32 | 通过 | E13 | 报告文件去重/冲突、人工来源绑定，不按自报 memberId 自动通过 |
| A33 | 通过 | E13、E14 | 旧功能正常、未知协议/schema 拒绝 |
| A34 | 未执行（部分证据） | E18 | 真机 Filesystem 保存/读回与 Share 可用已通过；系统「选择文件」往返需手测 |
| A35 | 未执行 | 无 | 手机小屏/深浅主题、错误不丢草稿、危险动作确认（P7 手测） |

## 6. 证据与命令记录

| ID | 日期 | 工序/验收项 | 命令与cwd，或设备/网络/步骤 | 退出码/观察结果 | 输出/产物位置 |
| --- | --- | --- | --- | --- | --- |
| E00 | 2026-10-07 | 文档基线 | 根目录 git status --short，在创建文档前执行 | 0，输出空；不代表功能测试通过 | 无产物 |
| E01 | 2026-10-07 | 文档一致性检查；非施工/验收执行 | 仅阅读三份根目录文档并写回PLAN、LEDGER；核对编号、范围、退出条件、六项补充与交叉引用；未联网、未运行命令 | 不适用退出码；A14纠正拒绝语义，A13区分发布响应与领取回执；P0–P7仍未开始，A01–A35仍未执行 | TEAM_COLLAB_PLAN.md、TEAM_COLLAB_LEDGER.md；无构建/测试/APK产物 |
| E02 | 2026-10-07 | 交接入口完善；非施工/验收执行 | 根目录 `git status --short`；改PLAN新增第8节、SPEC阅读顺序、LEDGER第1/7节 | git退出码0，输出仅 `?? TEAM_COLLAB_LEDGER.md`、`?? TEAM_COLLAB_PLAN.md`、`?? TEAM_COLLAB_SPEC.md`；无应用代码改动 | 三个md文档；无构建/测试/APK产物 |
| E03 | 2026-10-08 | P0/P1 领域与事务（A05–A13、A25–A27 部分） | `npx tsx scripts/test-team.ts` | 退出码0；30项断言全过：分阶段不累加、重清点替换、节点隔离、费用修订、发布版本幂等、规范化序列化、公共白名单、stale | 无产物（stdout） |
| E04 | 2026-10-08 | P1 数据库事务（A01、A12、A13、A25、A26、A27） | `npx tsx scripts/test-team-db.ts`（fake-indexeddb） | 退出码0；23项断言全过：旧trip保留、非组织者拒发、发布幂等不增版、expected过期拒绝、报告/回执幂等与异载荷冲突、领取事务入队、旧回执不降级 | 无产物（stdout） |
| E05 | 2026-10-08 | P0 旧回归 | `npx tsx scripts/test-settle.ts` / `test-tripfile.ts` / `test-lansession.ts` | 退出码0；结算、文件/ID、加密KAT全部通过；team 改动未破坏既有功能 | 无产物（stdout） |
| E06 | 2026-10-08 | P0 前端构建 | 根目录 `npm run build`（vue-tsc + vite） | 退出码0；4764 模块转换成功，产出 dist | dist/（未提交） |
| E07 | 2026-10-08 | P0 Android 构建与安装 | `JAVA_HOME=<Android Studio jbr 25> .\gradlew.bat assembleDebug`；`adb install -r` | 构建成功（93 tasks）；APK 10:31 生成；安装 Success | android/app/build/outputs/apk/debug/app-debug.apk |
| E08 | 2026-10-08 | P0 原生插件注册 | `adb shell am start` + `adb logcat` | `Registering plugin instance: TeamHost` 出现；应用启动无崩溃 | 无产物 |
| E09 | 2026-10-08 | P0 真机链路（A17、A19 相关） | `npx tsx scripts/p0-device-check.ts`（设备 3a3e1f52，CDP 驱动 WebView） | 全通过：handler 缺席→504（20034ms，不伪造ACK）；/info→200 且 body 正确；/action→200 且 64 字节载荷完整传入 JS；未知路径→404；OPTIONS→204；stop 后请求失败(-1) | 无产物（stdout） |
| E10 | 2026-10-08 | P0 真机密码互操作（A14/A16/A20） | `npx tsx scripts/p0-device-crypto.ts`（设备 3a3e1f52） | 通过：ECDH/HKDF/AES-GCM 与 AAD 绑定在真机 WebView 与 Node 侧互操作一致；错误 AAD → 500 | 无产物（stdout） |
| E11 | 2026-10-08 | P2 身份配对与凭证（A15/A16/A20/A21） | `npx tsx scripts/test-team-identity.ts` | 退出码0；30项全过：会话密钥成员间隔离、AAD/篡改/错key拒绝、逐成员凭证稳定与换设备撤销、审批签发、恢复配对保留 memberId 不重复名册 | 无产物（stdout） |
| E12 | 2026-10-08 | P3/P4/P5/P6 前端构建 | 根目录 `npm run build`（vue-tsc + vite） | 退出码0；4801 模块转换成功，产出 dist | dist/（未提交） |
| E13 | 2026-10-08 | P6 文件兜底（A31/A32/A33） | `npx tsx scripts/test-team-file.ts` | 退出码0；30项全过：公共文件白名单/无凭证密钥、round-trip、digest 自洽与新旧比较、报告去重/冲突、未知 format 拒绝、文件名清理 | 无产物（stdout） |
| E14 | 2026-10-08 | P6 旧回归（A33） | `npx tsx scripts/test-settle.ts` / `test-tripfile.ts` / `test-lansession.ts` | 退出码0；结算、文件/ID、加密KAT 全过；team 改动未破坏旧功能 | 无产物（stdout） |
| E15 | 2026-10-08 | P6 依赖与原生同步（A34 前置） | `npm install @capacitor/filesystem@^8 @capacitor/share@^8`；`npx cap sync android` | 退出码0；Found 2 Capacitor plugins for android（filesystem 8.1.4、share 8.0.3） | package.json、android 工程 |
| E16 | 2026-10-08 | P6 Android 构建与安装 | 系统 JDK 17 与 jbr 25 均不可用（Gradle 8.14.3 不支持 Java 25）；下载 OpenJDK 21.0.2 到 `.jdk21/`；`JAVA_HOME=.jdk21\jdk-21.0.2 gradlew assembleDebug --no-daemon`；`adb install -r` | BUILD SUCCESSFUL（154 tasks）；安装 Success | android/app/build/outputs/apk/debug/app-debug.apk |
| E17 | 2026-10-08 | P6 原生插件注册 | `adb shell am start` + `adb logcat -s Capacitor` | `Registering plugin instance: TeamHost / Filesystem / Share` 均出现；应用启动无崩溃 | 无产物 |
| E18 | 2026-10-08 | P6 真机文件往返（A34 部分） | `npx tsx scripts/p6-device-file.ts`（设备 3a3e1f52） | 通过：UTF-8 与 base64 写入后读回内容一致；uri=file:///data/user/0/com.liubarryteb12.knapsack/cache/…（应用私有目录）；Share.canShare=true | 无产物（stdout） |
| E19 | 2026-10-08 | 启动控制台观察（非验收项） | 连续 3 次 `am force-stop` + `am start` + `adb logcat -s Capacitor/Console` | 2/3 无错误；1/3 出现非确定性 `Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')`（Capacitor 启动竞态，与 P6 改动无关，功能未受影响；P7 复核） | 无产物 |
| E20 | 2026-10-21 | R15 清理与重建装机 | 删除 `android/app/src/main/java/com/liubarryteb12/knapsack/teamhost/`（先备份到 %TEMP%\knapsack-r15-backup\）与 `android/app/build.gradle` 的 nanohttpd 依赖；`npm run build` → `npx cap copy android` → `JAVA_HOME=.jdk21\jdk-21.0.2 gradlew assembleDebug --no-daemon` → `adb install -r`（设备 3a3e1f52） | 全链退出码 0；BUILD SUCCESSFUL in 47s；install Success；APK 8,331,683B SHA256 DADC14DF…47AD8；dex 扫描 nanohttpd 与 knapsack/teamhost 各 0 命中、根包 TeamHostPlugin 8 命中；logcat 三插件注册 | android/app/build/outputs/apk/debug/app-debug.apk |
| E21 | 2026-10-21 | 闪退取证与 P-a/P-b 修复（R16 前置） | `adb logcat -b crash`、`dumpsys dropbox`、5 轮 `am force-stop`+`am start`；改 `TeamHostPlugin.java`（volatile 字段、accept 循环局部快照 + `catch(Throwable)` 兜底、shutdown 先置 running=false 再逐个置 null、`handleOnDestroy`、`closeQuietly`、join 主线程守卫）；改 `src/team/teamHostService.ts`（addListener 提到 start 之前）+ `src/main.ts`（`recordFatal` + errorHandler + unhandledrejection） | 崩溃缓冲为空、dropbox 无 data_app_crash/ANR、5 轮冷启动全存活（进程没死 → 不是应用级崩溃）；修复后 20 轮开停主机 0 异常，`start() while running`=4 正好对应 4 次 double-start（sessionId 回写生效），teamhost-accept/accept loop recovered/FATAL/ANR 均 0 | 无产物（stdout）；脚本 scripts/p7-crash-sweep.ts |
| E22 | 2026-10-21 | 渲染进程崩溃定性（R16 证据） | `npx tsx scripts/p7-crash-sweep.ts`（全量 22 步，设备 3a3e1f52） | 前 13 步 pid 不变；share-sheet-x3 抓到 `E/chromium(30283): [ERROR:aw_browser_terminator.cc(156)] Renderer process (30332) crash detected (code -1)`，PSS 201948→130723KB；应用进程未死、无 FATAL；其后 8 步因 CDP 无 localhost 页面空转（未测到）。复现条件：PSS ≈200MB + 打开分享面板；冷启动低内存同路径不触发 | scripts/out/p7-crash-2026-10-21T12-12-29.json、scripts/out/p7-*.png |
| E23 | 2026-10-21 | 渲染进程自愈实测（R16 处置） | 新增 `android/…/RendererRecovery.java`，`MainActivity.onCreate` 里 `RendererRecovery.attach(this)`；CDP `Page.crash` 主动打掉渲染进程 | 崩溃前 `#/team/p7teamorg0001` → **+1693ms** 新 page target 出现 → 4s 后 `href` 原样恢复且 `plugins:true`，应用 pid 8220 全程不变；logcat：`onRenderProcessGone: didCrash=true …` → `recreate(): 开始重建 Activity` → 重建后三插件重新注册 → `onPageLoaded: 恢复路由`；重建后 5 轮 TeamHost 启停 ok；冷启动 3 轮存活、FATAL/ANR=0 | android/app/build/outputs/apk/debug/app-debug.apk（SHA256 BC3D2C73…E28AAB）；截图 %TEMP%\p9\after.png |
| E24 | 2026-10-21 | A34 根因与修复（toPlain） | 根因：`TeamMemberTab.vue:295` `importPreview.value = check` 产生深层响应式 Proxy，`confirmImport` 把 Proxy 快照传给 `ingestPublication` → `db.teamPublications.put` structured clone 抛 DataCloneError；修复：`src/db/teamActions.ts` 新增 `toPlain()`，落地 ingestPublication/acceptSubmission/publishSnapshot(itinerary)；`scripts/test-team-db.ts` 新增 A34 回归段 | `npx tsx scripts/test-team-db.ts` exit 0，A34 回归 16 条断言全过（负对照：直接 put 代理快照确实抛 `DataCloneError: #<Object> could not be cloned`；修复后入库行 impurity 为空、JSON 逐字节一致、幂等语义不变）；`test-team-file.ts`/`test-team.ts` 无回归；`npx vue-tsc --noEmit` exit 0 | scripts/test-team-db.ts（新增用例） |
| E25 | 2026-10-22 | 优化轮：逻辑键唯一性 + A08 stale + 金额纪律 + 死代码清理 | 根目录 `npx tsx scripts/test-team-db.ts`（退出码 0，79 行输出，含新增 15 条断言）；`npx vue-tsc --noEmit`（退出码 0）；`npm run build`（退出码 0，dist 产物正常）；7 个测试脚本全量回归（test-settle / test-tripfile / test-lansession / test-team / test-team-file / test-team-identity / test-team-db）全部退出码 0 | 修复前复现：同一逻辑键 2 条 confirmed、当前确认量随 reviewedAt 漂移；修复后唯一且确定 | scripts/test-team-db.ts（新增 testConfirmKeyUniqueness / testStaleOnDraftBump）、src/db/teamActions.ts、src/team/domain.ts、src/components/team/*.vue |
| E26 | 2026-10-22 | 优化轮：金额输入边界验证 | 根目录临时探针 `npx tsx scripts/_probe*.ts`（已删除） | 旧 `Math.round(Number(x)*100)`：`abc`→NaN、`1.005`→100（脏值入库）；改用 yuanToFen 后全部返回 null 并给人话报错 | src/utils/money.ts（既有）、src/components/team/TeamMemberTab.vue |
| E27 | 2026-10-22 | 优化轮：费用来源独占 + 成员校验 + 冗余校验清理 + 上报表单 | 根目录 `npx tsx scripts/test-team-db.ts`（退出码 0，新增 testExpenseReportIdOwnership / testExpenseMemberValidation 共 11 条断言）；`npx vue-tsc --noEmit`（退出码 0）；`npm run build`（退出码 0）；7 个测试脚本全量回归全部退出码 0 | 修复前复现：m3 复用 m2 的 expenseReportId 后确认入账，m2 的 3600 分被 9900 分静默覆盖，账本少一笔钱；payerMemberId='GHOST-USER' 可入账。修复后均被拒绝 | scripts/test-team-db.ts、src/db/teamActions.ts、src/components/team/TeamMemberTab.vue |实施者从E03追加。失败也登记。E01、E02仅为文档记录，不能作为任何工序退出或验收通过的证据。不要粘贴含凭证/密钥的日志；无需创建大批冗余截图或报告，保留复现必要证据即可。
| E28 | 2026-10-22 | 优化轮：内存与重复计算（R16 收尾） | 根目录基准脚本（300 批次/300 报告缺口总表 10 次重渲染：模板现算 37.1ms vs computed 预计算 1.70ms，22x；单团队聚合根 133.6KB vs 列表投影 9.3KB，-93.1%）；`npx tsx scripts/test-team-db.ts` 退出码 0（新增 testTeamListProjection 9 条断言）；`npx vue-tsc --noEmit` 退出码 0；`npm run build` 退出码 0；7 个测试脚本全量回归全部退出码 0 | 修复前：TripsView 模板每卡 3–4 次 reduce；TeamSummaryTab 每单元格 5 轮 submissions 遍历；团队列表页把每个团队的完整聚合根搬进内存 | src/views/TripsView.vue、src/components/team/TeamSummaryTab.vue、src/db/teamActions.ts、src/stores/teams.ts、src/views/TeamsView.vue、src/components/LanSessionModal.vue、src/components/team/TeamPublishTab.vue |
| E29 | 2026-10-22 | R16 真机 PSS A/B 复测（阴性结果） | 设备 3a3e1f52（小米 M2012K11AC / Android 13 / WebView 116.0.5845.92）；流程：构建 before(c9dd40b) 与 after(abc2449) 两个 APK → 校验 dex/res 完全一致（dex 8911KB / res 1109KB，确认 Java 层相同、仅前端资产不同）→ 交替安装 + force-stop + `npx --no-install tsx scripts/p7-crash-sweep.ts --only=session-start-stop-x5`，每轮约 20s | before 154347/157290 KB（均值 152.2 MB），after 154737/152822 KB（均值 150.2 MB）；差异 -2.0 MB / -1.3%，落在测量噪声内。崩溃信号 0、JS 异常 0。**结论：E28 的 JS 侧降载对 PSS 无显著影响** | scripts/out/p7-crash-2026-10-22T07-28-35.json、07-29-31.json（before）；另两次 A/B 输出见命令行 |## 7. 实际变更登记
| E30 | 2026-10-22 | 全量审核 + 消融实验（5 个 P0 修复） | 两路并行代码审核（领域层/持久化、前端组件/视图）逐条实证；`npx tsx scripts/test-team-db.ts` 退出码 0（新增 testP0Regressions 11 条断言）；`npx vue-tsc --noEmit` 退出码 0；`npm run build` 退出码 0；7 个测试脚本全量回归全部退出码 0 | 修复前实测：①并发 Promise.all 两个 publishSnapshot 同 operationId 得到 version 1 和 2、publicationId 不同；②畸形 draft（revision 字符串、qty=-999）写入后 getTeam 抛 zod 错，聚合根永久毒化；③taskRevision=1 报告在 draftRevision=5 时以 submitted 入库；④version=999999 + 不存在 publicationId 的回执被接受；⑤自报 digest='deadbeef' 的快照被接受 | src/db/teamActions.ts、src/stores/history.ts、src/components/BudgetTab.vue、scripts/test-team-db.ts |
| E31 | 2026-10-22 | 审核后续修复批次（A1-A6、B1/B2/B4/B5、C1/C2/C5-C7、D1-D5） | `npx vue-tsc --noEmit` 退出码 0；`npm run build` 退出码 0；7 个测试脚本全量回归全部退出码 0；中途实测发现并回退一个错误方案（确认推进 draftRevision 会把无关待审报告误判 stale），改用预览摘要比对方案 | 修复前：对 stale/rejected 报告可再次确认；费用 36/40 可同时 confirmed；currentConfirmedQty 比较器恒真；缺口只取数组末位节点；saveTeam 整包覆盖可丢并发写入；幂等命中不入队回执；AAD 未绑消息类型；join.status 不绑会话；replay 恒 false；非法预算静默存 0；双击重复提交；switchIp 并发交错；推送/拉取静默覆盖本地编辑 | 见变更登记 E31 各行 || 日期 | 工序 | 文件 | 变更目的 | 关联验收 | 状态 |
| E32 | 2026-10-22 | 审核后续批次二（D6-D14、E1/E4） | `npx vue-tsc --noEmit` 退出码 0；`npm run build` 退出码 0；7 个测试脚本全量回归全部退出码 0（test-team.ts 的 testPublish 更新为语义等价断言） | 修复前：设置开关写库失败不还原 UI；天气/二维码/AI 生成无过期请求守卫；扫码组件 start 失败不清理摄像头；成员导出含 stale 报告；receipts 不随 teamId 重载；matchMedia 监听 HMR 叠加；domain 存在与实现矛盾的发布死代码；TeamState.revision 死字段 | 见变更登记 E32 各行 || --- | --- | --- | --- | --- | --- |
| 2026-10-07 | 文档交接 | TEAM_COLLAB_SPEC.md | 需求、数据流、安全/兼容边界 | 全部定义 | 文档已写 |
| 2026-10-07 | 文档交接 | TEAM_COLLAB_PLAN.md | P0–P7计划、35项验收、命令与样例 | 全部定义 | 文档已写 |
| 2026-10-07 | 文档交接 | TEAM_COLLAB_LEDGER.md | 进度、决策、风险和证据台账 | 跟踪用途 | 文档已写 |
| 2026-10-07 | 文档补充复核 | TEAM_COLLAB_SPEC.md | 登记此前已补齐的六项歧义处理，定位见下表；本轮只读，未修改SPEC | 见下表 | 仅文档核对，未实现/未验收 |
| 2026-10-07 | 文档一致性修正 | TEAM_COLLAB_PLAN.md | A14改为「不处理，不返回成功ACK」；A13改为发布提交成功但响应丢失，避免混淆领取回执 | A13、A14 | 文档已修正，未执行验收 |
| 2026-10-07 | 文档一致性登记 | TEAM_COLLAB_LEDGER.md | 登记E01、六项补充与对应工序/验收，更新相关备注；保留全部未开始/未执行状态 | 跟踪用途 | 文档已更新，非功能证据 |
| 2026-10-07 | 交接入口完善 | TEAM_COLLAB_PLAN.md | 新增第8节：三文档事实源、可直接复制的开工指令、首次会话七项清单、暂停交接字段、建议skills；第1节补充开工回报与台账更新要求 | 开工与交接 | 文档已写，未开工 |
| 2026-10-07 | 交接入口完善 | TEAM_COLLAB_SPEC.md | 顶部阅读顺序指向PLAN第8节交接入口 | 开工与交接 | 文档已写，未开工 |
| 2026-10-07 | 交接入口完善 | TEAM_COLLAB_LEDGER.md | 第1节git行更新、第6节登记E02、第7节登记三处变更、第8节新增8.1交接说明 | 台账跟踪 | 文档已写，非功能证据 |
| 2026-10-08 | P0/P1 领域层 | src/team/protocol.ts、schema.ts、domain.ts、types.ts、teamProtocol.ts | 冻结协议常量、team.v1 schema、汇总/白名单/摘要/版本领域函数 | A03–A13 | 已实现，E03 |
| 2026-10-08 | P1 持久化 | src/db/index.ts、src/db/teamSchema.ts、src/db/teamActions.ts | Dexie v2 新增 5 张团队表；幂等/接收/确认/发布/领取/回执事务 | A01、A09、A12、A13、A25–A27 | 已实现，E04 |
| 2026-10-08 | P2 身份与传输 | src/team/identity.ts、teamHostNative.ts、teamHostService.ts、teamClient.ts | ECDH+HKDF+AES-GCM 信封、逐成员凭证、延迟 ACK 服务端、成员端客户端 | A14–A21 | 已实现，E10/E11 |
| 2026-10-08 | P0 原生插件 | android/…/TeamHostPlugin.java、MainActivity.java | 内置 HTTP 服务器、等待 JS 落库后回填响应、超时 504/超限 413 | A17、A19 | 已实现，E07–E09 |
| 2026-10-08 | P3–P5 UI | src/stores/teams.ts、views/TeamsView.vue、TeamDetailView.vue、components/team/TeamSetupTab.vue、TeamSummaryTab.vue、TeamPublishTab.vue、TeamMemberTab.vue、router/index.ts、App.vue | 团队列表/详情、分工设置、汇总确认、会话发布、成员领取上报 | A02、A23、A24、A30 | 已实现，E12（真机 UI 待 P7） |
| 2026-10-08 | P6 文件兜底 | src/team/teamFile.ts、src/utils/fileBridge.ts、package.json、.gitignore | 公共/报告独立文件格式、导入预览与人工来源绑定、Filesystem+Share 真实保存/分享、本地 JDK 21 忽略 | A31–A34 | 已实现，E13/E15/E16/E18 |
| 2026-10-08 | 测试脚本 | scripts/test-team.ts、test-team-db.ts、test-team-identity.ts、test-team-file.ts、p0-device-check.ts、p0-device-crypto.ts、p6-device-file.ts | 领域/事务/身份/文件单测与真机驱动脚本 | 全部 | 已实现，E03–E19 |
| 2026-10-21 | R15 清理 | android/app/src/main/java/com/liubarryteb12/knapsack/teamhost/（整目录删除）、android/app/build.gradle（删 nanohttpd 依赖） | 消除重复且未引用的原生插件实现，避免下次接手误改 | R15 | 已实现，E20 |
| 2026-10-22 | 优化：SPEC 3.3 逻辑键唯一 | src/db/teamActions.ts | decideSubmission 确认时把同逻辑键其他 confirmed 降级为 stale，消除「两个当前确认量」；新增 confirmKeyOf 辅助 | A06、A08 | 已实现，E25 |
| 2026-10-22 | 优化：A08 stale 落地 | src/db/teamActions.ts | saveTeam 在 draftRevision 推进时把依据旧版本的 submitted/confirmed 报告标 stale；此前该语义只存在于测试的手工输入里（循环论证），台账已更正 | A08 | 已实现，E25 |
| 2026-10-22 | 优化：金额纪律 | src/components/team/TeamMemberTab.vue、TeamSummaryTab.vue、TeamPublishTab.vue | 团队模块改用既有 yuanToFen/fenToYuan，替掉 Math.round(Number(x)*100)（会产生 NaN 与脏值）；非法输入给具体人话提示 | 项目硬规则 | 已实现，E25/E26 |
| 2026-10-22 | 优化：digest 不重复计算 | src/db/teamActions.ts | 仅在补 itinerary 后重算快照摘要，省掉每次发布一次全量摘要 | — | 已实现，E25 |
| 2026-10-22 | 优化：删恒 false 注入点 | src/team/domain.ts | 移除从未被调用的 setPendingCountChecker（模块级 pendingCountChecker 恒返回 false，却伪装成「待清点检测」）；改为显式 submissions 参数 + hasPendingCountReport | A07 | 已实现，E25 |
| 2026-10-22 | 工程卫生：忽略调试产物 | .gitignore | scripts/out/（14.9MB 真机截图）不再进入 git status，避免误提交 | — | 已实现，E25 || 2026-10-21 | 闪退修复 P-a | android/…/TeamHostPlugin.java | accept 循环异常逃逸杀进程、shutdown 竞态、start 幂等不回写 sessionId、句柄泄漏 | R16、A17、A19 | 已实现，E21 |
| 2026-10-22 | 优化：费用来源编号独占 | src/db/teamActions.ts | acceptSubmission 校验 expenseReportId 未被其他成员使用。修复前：他人复用后确认入账会按 ID 覆盖，静默丢掉别人的费用记录（实测 3600 分被 9900 分顶掉） | A15、A24 | 已实现，E27 |
| 2026-10-22 | 优化：费用入账成员校验 | src/db/teamActions.ts | decideSubmission 确认费用时校验 payerMemberId 在名册、名册非空（SPEC 3.5「正式数据校验成员存在」）。修复前幽灵付款人可入账 | A10、A24 | 已实现，E27 |
| 2026-10-22 | 优化：删冗余嵌套校验 | src/db/teamActions.ts | publishSnapshot 里 draftRevision 被同一个条件检查了两遍（外层 if 内层与紧接着的独立 if 完全相同） | A12 | 已实现，E27 |
| 2026-10-22 | 优化：上报任务版本与表单重置 | src/components/team/TeamMemberTab.vue | taskRevision 未领过快照时不再写死 1（会一改分工就变 stale），改用本机 draftRevision；上报成功后重置表单，避免下次打开残留导致误重复上报 | A08 | 已实现，E27 || 2026-10-21 | 闪退修复 P-b | src/team/teamHostService.ts、src/main.ts | 先 addListener 再 start（否则事件被 Capacitor 丢弃）；全局 errorHandler/unhandledrejection 记环形日志 | R16 | 已实现，E21 |
| 2026-10-22 | 优化：TripsView 预算统计缓存 | src/views/TripsView.vue | 模板里 usedFen/budgetPct 每卡被读 3–4 次，每次对整个 expenses reduce；改 WeakMap 按 trip 引用缓存，编辑换出新对象自然失效 | R16 | 已实现，E28 |
| 2026-10-22 | 优化：缺口总表预计算 | src/components/team/TeamSummaryTab.vue | counts/gap/uncounted 原在模板里现算，每单元格 5 轮 submissions 遍历（gapOf 内部又调 confirmedCount）；全部移入 rows computed，模板改纯读取。300 批次 10 次重渲染 37.1ms → 1.70ms | R16 | 已实现，E28 |
| 2026-10-22 | 优化：团队列表轻量投影 | src/db/teamActions.ts、src/stores/teams.ts、src/views/TeamsView.vue | 新增 listTeamSummaries，列表页只取展示字段（teamId/name/roster/各计数/发布状态），裁掉 submissions/expenses/pendingJoins/credentialSecret；store 拆出 teamList，详情页仍走 refresh(teamId) 取完整聚合根。单团队 133.6KB → 9.3KB | R16 | 已实现，E28 |
| 2026-10-22 | 优化：二维码生成可取消 | src/components/LanSessionModal.vue、src/components/team/TeamPublishTab.vue | watch(hostIp) 连续触发时多个 toDataURL 并发跑完，旧 dataURL 白占内存且可能后到覆盖新地址（二维码地址与监听地址不一致）；改自增序号只认最后一次。另给 switchIp 加失败回退，避免用户卡在无会话无二维码状态 | R16 | 已实现，E28 || 2026-10-21 | 渲染进程自愈 | android/…/RendererRecovery.java（新增）、android/…/MainActivity.java | 渲染进程死亡后重建 Activity 并恢复 hash 路由，替代白屏 | R16 | 已实现，E23 |
| 2026-10-22 | fix(P0)：幂等检查移入事务 | src/db/teamActions.ts | 新增 inTxIdempotent，publishSnapshot/acceptReceipt 的幂等读写全部进同一事务。修复前并发同 operationId 会发布出两个版本，违反 SPEC 4.2 | A12、A13 | 已实现，E30 |
| 2026-10-22 | fix(P0)：报告载荷过 schema | src/db/teamActions.ts | acceptSubmission 落库前 submissionSchema.parse。修复前畸形载荷可写入并毒化整个 TeamState，主机此后每次 getTeam 都抛 zod 错，该团队永久不可读写 | A10 | 已实现，E30 |
| 2026-10-22 | fix(P0)：旧版分工报告标 stale | src/db/teamActions.ts | acceptSubmission 对 taskRevision < draftRevision 的报告落为 stale 并写明原因，不进待审核列表。修复前组织者会把依据废弃分工的报告当新报告确认进汇总 | A08 | 已实现，E30 |
| 2026-10-22 | fix(P0)：回执校验发布版本 | src/db/teamActions.ts | acceptReceipt 校验 publicationId 存在、teamId 匹配、version 与记录一致。修复前成员可提交 version=999999 的假回执，主机永久显示「已领取第 999999 版」且单调递增无法纠正 | A26、A27 | 已实现，E30 |
| 2026-10-22 | fix(P0)：快照摘要重算 | src/db/teamActions.ts | ingestPublication 先 publicSnapshotSchema.parse 再重算 digest 与自报值比对。修复前携带自洽假摘要的快照被当「同一份」接受，成员端同 ID 异内容冲突判定失效 | A31 | 已实现，E30 |
| 2026-10-22 | fix(P1)：redo 失效 | src/stores/history.ts | undo/redo 改为先存「当前状态」再回退。修复前 redo 弹出的正是 undo 后的当前状态，redo 永远是 no-op，用户撤销的编辑永久找不回 | — | 已实现，E30 |
| 2026-10-22 | fix(P1)：按份分摊索引错位 | src/components/BudgetTab.vue | 加 watch 按位置对齐 shares 与 memberIds（删除移除该位、新增插入默认 1）。修复前取消勾选中间成员后，后面每人的份数整体前移，结算金额算错 | — | 已实现，E30 || 2026-10-21 | A34 修复 | src/db/teamActions.ts | 新增 toPlain()，写入 Dexie 前消除 Vue 响应式 Proxy（DataCloneError） | A34 | 已实现，E24 |
| 2026-10-22 | fix(A1)：review 状态校验 | src/db/teamActions.ts | decideSubmission 只允许 submitted 被确认/退回；stale 提示重新上报，confirmed/rejected 拒绝重复操作 | A23 | 已实现，E31 |
| 2026-10-22 | fix(A2)：费用旧确认降级 | src/db/teamActions.ts | 确认费用时按 expenseReportId 把同来源其他 confirmed 降级 stale；此前费用报告永不降级，36/40 同时挂 confirmed | A09 | 已实现，E31 |
| 2026-10-22 | fix(A3)：确认量比较器 | src/team/domain.ts | currentConfirmedQty 按 reviewedAt 真实比较（原条件恒真，实为数组序取值），结果可预测 | A05 | 已实现，E31 |
| 2026-10-22 | fix(A4)：缺口按节点分列 | src/team/domain.ts | summarizeAllocation 增加 gapByCheckpoint/gapCheckpointId，不再默认取数组末位节点 | A07 | 已实现，E31 |
| 2026-10-22 | fix(A5/A6)：saveTeam 读改写守卫 | src/db/teamActions.ts | 事务内 get 最新聚合，draftRevision 落后拒绝，submissions/expenses/发布指针一律取库值，编辑字段由调用方覆盖；stale 判定只作用于合并后的数据。实测旧快照编辑不再丢成员刚提交的报告 | A04 | 已实现，E31 |
| 2026-10-22 | fix(B1)：幂等命中补回执 | src/db/teamActions.ts | ingestPublication 命中已有 publicationId 时，若 queueReceipt 且 operationId 未入队则补入队；修复「文件导入后再在线领取，主机永远显示未领取」 | A25、A26 | 已实现，E31 |
| 2026-10-22 | fix(B2)：发布预览一致性 | src/db/teamActions.ts、src/components/team/TeamPublishTab.vue | PublishInput 增加 expectedPreviewDigest，发布时与实际快照 digest 比对，不一致拒绝并要求重看预览。注：曾试过确认时推进 draftRevision 的方案，实测会把无关待审报告误判 stale，已回退并记录原因 | A12、SPEC 4.2 | 已实现，E31 |
| 2026-10-22 | fix(B4)：digest 注释如实标注 | src/team/domain.ts、src/team/schema.ts | 注明 FNV-1a 32 位实现与职责边界（完整性由 AES-GCM 保证），schema 注释不再声称 sha-256 | — | 已实现，E31 |
| 2026-10-22 | fix(B5)：join.status 绑会话 | src/db/teamActions.ts、src/team/teamHostService.ts | getJoinStatus 校验请求会话公钥与登记 clientPub 一致，凭证只交付给发起申请的会话 | A20、A21 | 已实现，E31 |
| 2026-10-22 | fix(C1)：AAD 绑定动作类型 | src/team/identity.ts、src/team/teamClient.ts、src/team/teamHostService.ts | buildAad 增加 type/operationId；客户端加密时写入，主机解密后用完整 AAD 加密响应，载荷类型被篡改即 GCM 认证失败 | A14、A16 | 已实现，E31 |
| 2026-10-22 | fix(C2/C6/C7) | src/team/protocol.ts、src/team/schema.ts、src/db/teamActions.ts | 死常量标注原生执行点（TeamHostPlugin 的 413/504）；阶段枚举统一到 protocol 单源；发布幂等载荷纳入 itinerary | — | 已实现，E31 |
| 2026-10-22 | fix(C5)：replay 标记 | src/db/teamActions.ts、src/team/teamHostService.ts | 幂等重放路径补 replayed 标记，hostService 转成协议层 replay，客户端可区分新建与重放 | — | 已实现，E31 |
| 2026-10-22 | fix(D1/D2)：防重复提交 | src/components/BudgetTab.vue、src/components/team/TeamSummaryTab.vue | 花费保存加 saving 守卫；确认加 confirmingId 且 operationId 稳定化（双击命中幂等重放） | — | 已实现，E31 |
| 2026-10-22 | fix(D3)：switchIp 互斥 | src/components/team/TeamPublishTab.vue | switching 锁防止并发 stop/start 交错 | — | 已实现，E31 |
| 2026-10-22 | fix(D4)：覆盖前确认 | src/components/LanSessionModal.vue | 接入方推送与主机拉取覆盖本地版本前弹确认对话框，不再静默覆盖 | — | 已实现，E31 |
| 2026-10-22 | fix(D5)：非法金额拒绝 | src/views/TripsView.vue | 新建旅行预算非法时明确报错，不再静默存 0 | — | 已实现，E31 || 2026-10-21 | P7 测试脚本 | scripts/p7-device-single.ts、p7-a22-restore.ts、p7-a28-restart.ts、p7-a30-offline.ts、p7-a34-file.ts、p7-a34-picker.ts、p7-a35-ui.ts、p7-e19-launch-race.ts、p7-crash-sweep.ts、scripts/lib/p7-*.ts | P7 单机验收自动化（CDP 驱动 WebView + adb 驱动选择器）与崩溃压测 | A22、A28、A30、A34、A35、E19、R16 | 已实现，E22–E25 |
| 2026-10-22 | fix(D6-D14)：UI 健壮性 | src/views/SettingsView.vue、WeatherStrip.vue、TripDetailView.vue、AiDraftModal.vue、QrScanner.vue、team/TeamMemberTab.vue、team/TeamPublishTab.vue、stores/theme.ts | 设置开关失败还原；天气/AI 生成加序号守卫防过期响应（AI 关闭即作废）；WeatherStrip key 绑 trip.id；扫码 start 失败清理摄像头、卸载后立即释放；导出过滤 stale/withdrawn；receipts 随 teamId 重载；matchMedia 监听去重 | — | 已实现，E32 |
| 2026-10-22 | chore(E1/E4)：死代码清理 | src/team/domain.ts、src/team/schema.ts、src/db/teamActions.ts、src/stores/teams.ts、scripts/test-team.ts | 删除 nextPublishVersion/publicationConflict（与实现矛盾、无调用方），发布语义内聚进事务并留注释指路；删除 TeamState.revision 死字段（全库无读逻辑）；testPublish 更新为语义等价断言 | — | 已实现，E32 |
本轮核对结果：P0–P7工序与依赖、A01–A35编号及阶段退出条件可对应；P4业务样例对应A05–A11，P7覆盖全部适用验收项。六项补充未新增或重编号规格章节，SPEC 5.2在6.3/7.3中的引用有效，下表定位均存在。A29仍仅在实现独立任务确认时适用；Android、前台服务限制、密码方案和文件格式等建议默认没有改写为用户明确决策，具体实现选择仍待P0/P1。

（以上为 2026-10-07 文档核对轮的记录。2026-10-08 的实现选择已按 D13–D18 落地，P0/P1 已完成。）

下表只登记既有规格补充，不新设需求，也不新增用户确认或关闭风险；来源与边界仍以SPEC 1.1/1.2及各段正文为准。

| 序号 | 已补充内容 | 规格定位（TEAM_COLLAB_SPEC.md） | 计划工序/验收（TEAM_COLLAB_PLAN.md） | 实际状态 |
| --- | --- | --- | --- | --- |
| 1 | 首次配对凭证响应丢失/保存失败/重启的人工恢复，保留身份并撤销旧凭证 | 6.2 | P0、P2、P3；A20、A21 | 已有文档补充，未实现/未执行 |
| 2 | 新会话重新认证加密后合法重试原业务operationId，与拒绝旧会话密文分开 | 5.2、6.3 | P0、P1、P2；A16、A18 | 已有文档补充，未实现/未执行 |
| 3 | 快照、当前指针、稳定回执outbox同事务保存，落库后发送并可补传 | 4.3、5.2 | P0、P1、P5；A25、A26 | 已有文档补充，未实现/未执行 |
| 4 | 同批次/阶段/节点唯一当前确认逻辑键，不同报告来源竞争需明确替换 | 3.3 | P0、P1、P4；A05、A06、A07 | 已有文档补充，未实现/未执行 |
| 5 | 费用报告作者与实际付款人分开，修订/撤回按作者授权 | 3.5、6.2 | P1、P2、P3、P4；A09、A15、A24 | 已有文档补充，未实现/未执行 |
| 6 | 发布版本、快照、最新指针、日志、幂等结果原子提交，丢响应重试不增版 | 4.2、5.2 | P0、P1、P5；A12、A13 | 已有文档补充，未实现/未执行 |

不在此声明尚不存在的功能代码、APK或测试结果。

## 8. 每阶段/每次会话交接

下一AI在暂停、遇阻或阶段完成时更新以下字段：

- 当前工序与最后一个实际完成的动作。
- 本次实际修改文件及尚未提交的工作区状态。
- 测试/手测证据ID，失败项及未执行原因。
- 当前协议/schema/数据库版本和已选依赖。
- 仍待用户决策的范围变更；没有则写「无」。
- 下一步的唯一优先动作与依赖条件。

本轮交接：完成三份根目录文档一致性检查；仅修改PLAN、LEDGER，SPEC无需改动，六项既有补充已登记。未编辑应用代码、未联网、未运行任何命令、未创建额外文件、未提交/推送；工作区未以git重新核验。P0–P7均未开始，A01–A35均未执行，无新增用户范围决策。下一动作：实施AI阅读SPEC/PLAN，说明采用的建议默认值并核对当前工作区，启动P0手机技术验证。

（2026-10-08 之后的交接见 8.2。）

### 8.1 完善交接入口（2026-10-07）

本轮在PLAN新增第8节「交接入口与首次会话清单」，SPEC顶部补充阅读顺序指向该节，使三份文档自包含，不再依赖临时目录索引。同时补充LEDGER第1节git行与第6节E02证据、第7节变更登记。

| 项 | 内容 |
| --- | --- |
| 三份文档 | SPEC（规则事实源）、PLAN（工序＋第8节交接入口）、LEDGER（进度台账） |
| 开工指令 | PLAN 8.1 代码块可直接复制给实施AI |
| 首次会话清单 | PLAN 8.2 七项顺序动作，缺项须登记原因 |
| 暂停交接 | PLAN 8.3 与本节字段一致 |
| 建议skills | PLAN 8.4；仅环境提供时调用，不安装新skill |
| git状态 | 2026-10-07 根目录 `git status --short` 退出码0，输出仅三个未跟踪md文件，无应用代码改动 |
| 未做 | 未改应用代码、未装依赖、未构建/测试、未真机、未commit/push |

本轮交接（含8.1）：文档交接入口完善完毕，仍是文档状态。P0–P7均未开始，A01–A35均未执行，无新增用户范围决策。下一动作：实施AI按PLAN 8.1指令与8.2清单开工，先回报默认值与工具链，再启动P0。

### 8.2 P0–P6 实现（2026-10-08）

| 项 | 内容 |
| --- | --- |
| 当前工序与最后动作 | P0/P1 已完成；P2–P5 代码与单元/真机链路测试完成，待真机端到端；P6 文件兜底代码完成（真机保存/分享通过，系统选择往返待手测）；最后动作＝`npx tsx scripts/p6-device-file.ts` 通过 |
| 本次修改文件 | 新增：src/team/{protocol,schema,domain,types,identity,teamProtocol,teamClient,teamHostNative,teamHostService,teamFile}.ts、src/db/{teamSchema,teamActions}.ts、src/utils/fileBridge.ts、src/stores/teams.ts、src/views/{TeamsView,TeamDetailView}.vue、src/components/team/{TeamSetupTab,TeamSummaryTab,TeamPublishTab,TeamMemberTab}.vue、android/…/TeamHostPlugin.java、scripts/{test-team,test-team-db,test-team-identity,test-team-file,p0-device-check,p0-device-crypto,p6-device-file}.ts；修改：src/db/index.ts、src/router/index.ts、src/App.vue、android/…/MainActivity.java、package.json、.gitignore |
| 未提交工作区 | 全部改动未 commit、未 push；`.jdk21/` 本地工具链已 gitignore |
| 测试/手测证据 | E03–E19；失败项：无。未执行：A22、A28、A30、A35 与 A34 的「选择文件」往返（真机手测，P7）；E19 为非验收观察 |
| 协议/schema/依赖版本 | 协议 `knapsack-team/1`；schema `team.v1`；文件 `team-publication.v1` / `team-submission.v1`；Dexie v2；新增 @capacitor/filesystem 8.1.4、@capacitor/share 8.0.3 |
| 待用户决策的范围变更 | 无 |
| 下一步唯一优先动作 | P6 收尾 + P7：手测系统「选择文件」真实往返（导出→分享/保存→选择导入）与旧 trip/局域网真机回归；随后按 PLAN 第 5 节做三设备现场样例（甲主机/乙采购/丙携带，水 24 瓶，私人标记串 `PRIVATE-NOTE-DO-NOT-SHARE`），并把 A22/A28/A30/A34/A35 结果登记回本台账 |
| 依赖条件 | 需 1 台 Android 主机 + 至少 2 台成员设备（同 Wi‑Fi 或热点）；Android 构建需 JDK 21（`.jdk21/`，见 D18） |
