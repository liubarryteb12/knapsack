# 行囊 Knapsack v1.3.0 开发者指南

本文面向开发和维护人员。普通用户请阅读 [用户使用教程](USER_GUIDE.md)。

## 环境要求

- Node.js 20+
- npm
- Windows 桌面构建需要 Rust 与 MSVC 工具链
- Android 构建需要 JDK 21、Android SDK 和 Gradle Wrapper

## 快速开始

```bash
npm install
npm run dev
```

开发地址默认为 `http://localhost:5173`。

## 构建

### Web

```bash
npm run build
```

### Windows 桌面版

```bash
npx tauri build
```

主要产物：

- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/app.exe`

### Android

```bash
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

macOS 或 Linux 使用 `./gradlew assembleDebug`。

Android 参数：

- applicationId：`com.liubarryteb12.knapsack`
- minSdk：24
- targetSdk：36
- versionCode：6
- versionName：`1.3.0`

### Android Release 签名

复制 `android/keystore.properties.example` 为 `android/keystore.properties`，填写：

- `KNAPSACK_KEYSTORE`
- `KNAPSACK_STORE_PASSWORD`
- `KNAPSACK_KEY_ALIAS`
- `KNAPSACK_KEY_PASSWORD`

然后运行：

```bash
cd android
.\gradlew.bat assembleRelease
```

未提供签名文件时，release 构建会回退到 Android debug key，只适合内部试用。

## 测试与审计

```bash
npm test
npm run audit:boundary
npm run audit:modules
npm run mod:sync
```

当前发布门禁见：

- `docs/RELEASE_GATE_v1.3.0.md`
- `docs/KNOWN_ISSUES_v1.3.0.md`
- `docs/V4_MODULARIZATION_PLAN.md`

## 代码结构

- `src/core/`：模块注册、能力总线、插槽、备份和数据库沙箱
- `src/engines/`：通用分享、时间线、账本等引擎
- `src/mods/`：旅行、每日、账房、提示词和团队模块
- `src/mods/mod-*/manifest.ts`：模块路由、导航、私有表和能力声明
- `src/mods/manifest-index.ts`：自动生成的模块索引

新增或调整模块后运行：

```bash
npm run mod:sync
```

## 模块边界

- `src/core/` 与 `src/engines/` 不导入具体模块。
- 模块之间不直接导入兄弟模块。
- 跨模块读取使用 CapabilityBus。
- 页面扩展使用 SlotManager。
- 模块关闭后能力查询返回空数组，插槽贡献卸载，历史数据保留。
- 旧业务表与旧模块表在 1.3.0 继续保留，用于升级和回滚。

## 数据库与数据格式

- 数据库名继续使用 `knapsack`。
- 新代码读写 `mod_*` 沙箱表。
- 旧表保留一个版本，不在 1.3.0 删除。
- 旅行 Schema 的唯一事实源是 `src/mods/mod-trip/schema.ts`。
- 金额统一使用整数分。
- 日期使用本地 `YYYY-MM-DD`，时间使用 `HH:mm`。
- `.trip` 导入必须经过格式检查和 Zod 校验。

## 局域网会话

- 应用标识：`knapsack-session/1`
- Rust 实现：`src-tauri/src/session.rs`
- 前端实现：`src/engines/lan-share-engine/lanSessionProtocol.ts`
- 端点：`GET /info`、`POST /pull`、`POST /push`
- 载荷使用 AES-256-GCM 信封加密。
- 会话密钥只出现在二维码或会话码中。
- 同步为整份覆盖，不做字段级合并。
- 关闭主机会话面板后，接入立即失效。

跨语言向量测试见 `scripts/test-lansession.ts`。

## 团队分享

- 团队模块：`src/mods/mod-team/`
- 标准包 Schema：`src/core/types/shareable-package.schema.ts`
- 分片与重组：`src/engines/lan-share-engine/packet-chunker.ts`
- 版本链：`src/engines/lan-share-engine/share-lineage.ts`
- Diff：`src/engines/lan-share-engine/diff-engine.ts`
- 签名摘要：`src/engines/lan-share-engine/digest-signer.ts`

标准包 SHA-256 只负责内容完整性，不承担身份认证。作者身份和合入决定由本机审核流程承担。

## 安全边界

- 核心业务数据保存在本机 IndexedDB。
- 无账号、无云端数据库、无遥测、无云同步。
- AI 接口 Key 使用本机密钥加密后保存。
- Android 关闭系统应用备份。
- 跨边界数据先经过 Schema 校验再写入。
- 应用不接入支付、转账、银行卡或其他金融接口。

## 发布文档

历史版本和本版本发布信息位于 `docs/`：

- `RELEASE_NOTES_v1.3.0.md`
- `RELEASE_GATE_v1.3.0.md`
- `KNOWN_ISSUES_v1.3.0.md`
- `MODULE_INTERACTION_MATRIX.md`
- `V4_MODULARIZATION_PLAN.md`
