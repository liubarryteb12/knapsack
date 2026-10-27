# 行囊 Knapsack v1.2.0 发布门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 自动化回归 | 通过 | `npm test`，31 个测试文件，0 失败 |
| Web/Vue 构建 | 通过 | `npm run build` |
| 发布边界 | 通过 | `npm run audit:boundary`，9/9 |
| 模块边界 | 通过 | `npm run audit:modules`，0 失败、0 警告 |
| Windows 安装 | 通过 | NSIS 静默安装，`app.exe` 版本 1.2.0，进程启动成功 |
| Android 构建 | 通过 | `assembleRelease`，versionCode 5，versionName 1.2.0 |
| Android 安装 | 通过 | K20 `69b31964`，`adb install -r` 成功，主 Activity 前台运行 |
| 发布产物 | 通过 | release 目录包含 APK、NSIS setup、portable 与 SHA-256 |

## 分发边界

- Android release 为 debug keystore 签名的内部试用包。
- Windows NSIS 和 portable 未做商业代码签名。
- 正式分发前需要替换 Android release 签名并完成 Windows 代码签名。
