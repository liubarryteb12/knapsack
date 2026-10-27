# 行囊 Knapsack v1.3.0 发布门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 自动化回归 | 通过 | `npm test`，37 个测试文件，0 失败 |
| Web/Vue 构建 | 通过 | `npm run build` |
| 发布边界 | 通过 | `npm run audit:boundary`，13/13 |
| 模块边界 | 通过 | `npm run audit:modules`，0 失败 |
| Windows 构建 | 通过 | Tauri release、NSIS setup 与 portable 均为 1.3.0 |
| Windows 安装 | 通过 | NSIS 静默安装退出码 0，`app.exe` 文件版本 1.3.0，进程响应正常 |
| Android 构建 | 通过 | `assembleDebug`、`assembleRelease`，versionCode 6，versionName 1.3.0 |
| Android 安装 | 通过 | K20 `69b31964` 与 M2012K11AC `3a3e1f52` 均 `adb install -r` 成功 |
| Android 启动 | 通过 | 两台设备 MainActivity 冷启动返回 `Status: ok` |
| 发布产物 | 通过 | 六个 APK/setup/portable/别名产物齐全 |
| 发布清单 | 通过 | `release/manifest.json` 版本与产物一致 |
| 发布校验和 | 通过 | `release/SHA256SUMS.txt` 六个产物逐项复算一致 |

## 分发边界

- Android release 当前使用 debug keystore 签名，仅适合内部试用。
- Windows NSIS 和 portable 未做商业代码签名。
- 正式公开分发前需要替换 Android release keystore，并完成 Windows 代码签名。
