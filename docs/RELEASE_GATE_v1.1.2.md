# 行囊 Knapsack v1.1.2 发布门禁

日期：2026-10-23

| 门禁 | 要求 | 证据 | 状态 |
|---|---|---|---|
| RG-P0-01 | 15 个回归脚本全绿 | `scripts/test-*.ts` | 🟢 通过 |
| RG-P0-02 | 类型检查与生产构建通过 | `npm run build` | 🟢 通过 |
| RG-P0-03 | 网络触发与权限边界通过 | `npm run audit:boundary` 9/9 | 🟢 通过 |
| RG-P0-04 | 长列表不加载完整聚合根 | `test-trip-summary` + `bench-trip-list` | 🟢 通过 |
| RG-P0-05 | 账房窗口查询与月份竞态 | `test-finance` + `bench-finance-query` | 🟢 通过 |
| RG-P0-06 | 无批次费用链路 | `test-team-db` | 🟢 通过 |
| RG-P0-07 | 发布预览摘要与幂等 | `test-publish-preview`、`test-team-db` | 🟢 通过 |
| RG-P1-01 | 双端构建资产同步 | Web dist、Android assets、Tauri dist | 🟢 通过 |
| RG-P1-02 | 安装包校验和 | `release/SHA256SUMS.txt`、`manifest.json` | 🟢 通过 |
| RG-P1-03 | 真机安装复核 | 用户明确要求手动处理设备测试 | 🟡 未执行 |
| RG-P1-04 | 正式商店签名 | 当前使用 debug keystore | 🟡 内部试用豁免 |

## 当前交付边界

- 只发布本机优先的内部试用包。
- 不接支付、转账、银行卡、遥测或云同步。
- 网络调用仅限用户主动触发的 AI、天气和同一 WiFi 局域网会话。
