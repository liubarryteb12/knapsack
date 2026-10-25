# 行囊 Knapsack v1.1.0 发布说明

## 版本定位

v1.1.0 是“旅行 + 每日规划 + 日常账房”的候选版，适合小范围试用和验收，不建议直接扩大分发。

## 新增与完成

- 模块注册表：旅行、每日规划、日常账房可独立开关。
- 每日规划：任务、时间块、完成状态、随手备忘自动保存、每日三问复盘、日期隔离。
- 日常账房：快速记账、编辑/删除、分类筛选、月度合计、近 7 日趋势、分类占比。
- 旅行花费导入账房：按来源去重，不修改旅行账本。
- 双端安装：Android Release/Debug、Windows setup/portable。

## 边界

- 数据默认存本机 IndexedDB。
- 无账号、无云同步、无遥测、无支付/转账/银行卡接口。
- 可选 AI 会访问用户配置的外部接口。
- 可选天气会访问 Open-Meteo。
- 局域网会话只在同一 WiFi 内使用。

## 已知问题

详见 `docs/KNOWN_ISSUES_v1.1.0.md`。v1.1.0 暂不提供备份/恢复、回收站、自定义分类、本地 PIN、提醒和 CSV/PDF 导出。

## 安装

- Android：`release/Knapsack-release.apk`
- Android 调试：`release/Knapsack-debug.apk`
- Windows 安装：`release/Knapsack-setup.exe`
- Windows 免安装：`release/Knapsack-1.1.0-portable.exe`
- 校验和：`release/SHA256SUMS.txt`
- 产物清单：`release/manifest.json`

## 验收命令

```bash
npx tsx scripts/test-daily.ts
npx tsx scripts/test-finance.ts
npx tsx scripts/test-mod-registry.ts
npm run audit:boundary
npm run build
```

## 分发限制

当前 release APK 使用 debug keystore 签名，仅用于内部试用。正式分发前需要独立 release keystore；Windows 安装包当前未做商业代码签名，SmartScreen 可能提示未知发布者。
