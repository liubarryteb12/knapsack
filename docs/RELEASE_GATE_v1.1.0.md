# 行囊 Knapsack v1.1.0 发布门禁

状态：候选版冻结中
日期：2026-10-23
适用范围：Android Release、Windows Tauri、Web 同源构建

## 1. 冻结规则

- v1.1.0 不再新增功能，只允许修复 P0/P1 或记录书面豁免。
- v1.1.x 只做低风险小补；v1.2 再做日常场景扩展。
- 正式分发只使用 `Knapsack-release.apk`；debug 包仅内部保留。
- Windows `setup.exe` 与 `portable.exe` 必须标明适用场景。

## 2. 缺陷分级

| 级别 | 定义 | 发布处理 |
|---|---|---|
| P0 | 安装/启动失败、数据丢失、金额错误、日期串数据、边界声明被破坏 | 必须清零 |
| P1 | 核心流程不可用或结果明显错误 | 修复或书面豁免 |
| P2 | 有替代路径的体验问题 | 可进入 v1.1.x |
| P3 | 视觉、动效、密度优化 | 进入 backlog |

## 3. 发布门禁表

| 编号 | 级别 | 检查项 | 通过标准 | 证据 | 状态 |
|---|---|---|---|---|---|
| RG-P0-01 | P0 | Android 安装与启动 | v1.1.0 release 安装成功、可启动 | `adb dumpsys package`：versionCode 2 / versionName 1.1.0 | 🟢 通过 |
| RG-P0-02 | P0 | Windows 启动 | setup/portable 可启动 | portable 进程与窗口标题 | 🟢 通过 |
| RG-P0-03 | P0 | 数据正确性 | 日期隔离、自动保存、金额守恒、导入去重 | `test-daily`、`test-finance`、`test-team-db` | 🟢 通过 |
| RG-P0-04 | P0 | 边界合规 | 无支付/遥测/第三方统计 SDK；网络仅限显式可选功能 | `npm run audit:boundary`：8 通过 / 0 失败 | 🟢 通过 |
| RG-P0-05 | P0 | 安装包完整性 | release/debug/setup/portable 与校验和一致 | `release/SHA256SUMS.txt`、`release/manifest.json` | 🟢 通过 |
| RG-P1-01 | P1 | 三端导航一致 | Web/Android/Windows 均有旅行/每日/账房/团队/设置 | 本地浏览器、手机、portable | 🟢 已走查 |
| RG-P1-02 | P1 | 模块开关 | 关闭只隐藏入口，数据保留；重新开启恢复 | `test-mod-registry`、设置页走查 | 🟢 通过 |
| RG-P1-03 | P1 | 本地数据升级 | v1/v2/v3 表升级不破坏旧数据 | `test-team-db`、Dexie v4 打开 | 🟢 通过 |
| RG-P1-04 | P1 | 备份/恢复 | v1.1.0 未实现，必须作为已知问题书面豁免 | `KNOWN_ISSUES_v1.1.0.md` | 🟡 豁免 |
| RG-P1-05 | P1 | 回收站/误删恢复 | v1.1.0 未实现，进入 v1.1.x | backlog | 🟡 豁免 |
| RG-P2-01 | P2 | 空状态与文案统一 | 三模块一致、错误可理解 | 走查 | 🟡 试用期 |
| RG-P2-02 | P2 | 账房自定义分类/标签 | 进入 v1.1.x | backlog | 🟡 待排期 |
| RG-P3-01 | P3 | 动效、密度、快捷键 | 进入 backlog | backlog | 🟡 待排期 |

## 4. 边界声明（必须与 README/发布说明一致）

- 数据默认 100% 存在本机 IndexedDB。
- 无账号、无云同步、无遥测、无支付/转账/银行卡接口。
- 可选 AI 行程草稿会访问用户配置的 OpenAI 兼容接口。
- 可选天气会访问 Open-Meteo。
- 局域网会话只在同一 WiFi 内连接用户自己的设备。
- 不允许后台静默联网、第三方统计 SDK 或在线协作。

## 5. 分发策略

- Android 正式试用：`release/Knapsack-release.apk`
- Android 内部调试：`release/Knapsack-debug.apk`
- Windows 安装：`release/Knapsack-setup.exe`
- Windows 免安装：`release/Knapsack-1.1.0-portable.exe`
- 校验和：`release/SHA256SUMS.txt`

> 当前 release APK 使用 debug keystore 签名，仅适合内部试用；正式对外分发前必须换成独立 release keystore。
