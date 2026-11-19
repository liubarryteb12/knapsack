# 行囊 Knapsack v1.4.0 发布门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 自动化回归 | 通过 | `npm test`，40 个测试文件，0 失败 |
| Web/Vue 构建 | 通过 | `npm run build` |
| 模块边界 | 通过 | `npm run audit:modules` |
| 发布边界 | 通过 | `npm run audit:boundary`，13 通过 0 失败 |
| Rust 构建 | 通过 | `npx tauri build`（toolchain 1.90.0） |
| Windows 打包 | 通过 | `Knapsack_1.4.0_x64-setup.exe`，NSIS |
| Windows 安装 | 通过 | 覆盖安装到 `%LOCALAPPDATA%\Knapsack`，`app.exe` 文件版本 1.4.0，界面版本号 `v1.4.0` |
| Windows 数据保留 | 通过 | 升级后旅行 1 条、提示词 11 条、每日 6 条仍在 |
| Windows 目标模块 | 通过 | 导航出现「目标」，导入 → 预览 → 入库 → 重启持久化实测通过 |
| Android 构建 | 通过 | `assembleRelease`、`assembleDebug`，versionCode 9、versionName 1.4.0 |
| Android 安装 | 通过 | 覆盖安装到 Redmi K20 Pro `3a3e1f52`，版本回读 1.4.0 (9) |
| Android 目标模块 | 通过 | 导入 → 预览 → 入库 → 强杀重启后仍在 → 重复包提示 → 本地状态不被覆盖 |
| 备份恢复 | 通过 | 桌面与 Android 两端：导出含 6 张 `mod_goals_*` 表；恢复后目标回到备份时状态，其余表与基线逐表哈希一致 |
| AI 拆解 | 通过 | 真实 OpenAI 兼容接口两轮联调：澄清 5 问 → 5 个里程碑，日期以当天为基准 |
| 发布清单 | 通过 | `release/manifest.json` 已切换到 1.4.0 |
| 发布校验和 | 通过 | `release/SHA256SUMS.txt` 已生成 |

## 分发边界

- Android release 当前使用 debug keystore 签名，仅适合内部试用。
- Windows NSIS 和 portable 未做商业代码签名。
- 正式公开分发前需要替换 Android release keystore，并完成 Windows 代码签名。
