# 行囊 Knapsack v1.3.2 发布门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 自动化回归 | 通过 | `npm test`，38 个测试文件，0 失败 |
| Web/Vue 构建 | 通过 | `npm run build` |
| 模块边界 | 通过 | `npm run audit:modules` |
| Rust 编译 | 通过 | `cargo check --offline` |
| 提示词分享链接 | 通过 | 自动化覆盖链接往返、旧分享码、旧网页链接、聊天文本和损坏链接 |
| 50,000 字上限 | 通过 | Schema 边界测试 |
| 下拉与手填 | 通过 | 预设、旧值回填、手填合并和去重测试 |
| Windows 构建 | 通过 | Tauri release、NSIS setup 均为 1.3.2 |
| Windows 安装 | 通过 | 已覆盖安装到当前用户，`app.exe` 版本回读为 1.3.2 |
| Android 构建 | 通过 | `assembleRelease`、`assembleDebug`，versionCode 8，versionName 1.3.2 |
| Android 安装 | 通过 | 已覆盖安装到 Redmi K20 Pro `69b31964`，版本回读为 1.3.2 (8) |
| Windows 链接导入 | 通过 | 冷启动与运行中点击分享链接，用户实测可用 |
| Android 链接导入 | 通过 | 冷启动与运行中点击分享链接，用户实测可用 |
| 发布清单 | 通过 | `release/manifest.json` 已切换到 1.3.2 |
| 发布校验和 | 通过 | `release/SHA256SUMS.txt` 已生成 |

## 分发边界

- Android release 当前使用 debug keystore 签名，仅适合内部试用。
- Windows NSIS 和 portable 未做商业代码签名。
- 正式公开分发前需要替换 Android release keystore，并完成 Windows 代码签名。
