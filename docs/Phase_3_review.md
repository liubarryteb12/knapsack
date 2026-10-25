# Phase 3 · mod-finance 审查包

日期：2026-10-23
状态：v1.1.0 发布门禁通过，等待小范围试用反馈

## 本轮交付

- `src/mods/mod-finance/schema.ts`：`finance-entry.v1`，金额整数分、分类、来源键。
- `src/mods/mod-finance/stats.ts`：月度合计、分类占比、近 7 日趋势纯函数。
- `src/mods/mod-finance/store.ts`：本地账目 CRUD 与旅行花费导入去重。
- `src/mods/mod-finance/FinanceView.vue`：`/finance` 快速记账、筛选、统计、趋势和导入界面。
- `src/db/index.ts`：IndexedDB 升级 v4，新增 `financeEntries` 表。
- `src/core/modRegistry.ts`、`src/router/index.ts`、`src/App.vue`、`src/views/SettingsView.vue`：账房模块注册、路由、导航和开关。
- `scripts/test-finance.ts`：金额、统计守恒、旅行导入去重和旅行表只读回归。

## 验证证据

- `npx tsx scripts/test-finance.ts`：21 条断言通过。
- 全部 14 个测试脚本：退出码 0。
- `npm run build`：通过。
- 本地浏览器：账房新增、编辑、删除通过；窄屏横向溢出已修复。
- 测试账目已清理。
- `npm run audit:boundary`：8 项边界审计通过。
- Android release 已安装：versionCode 2 / versionName 1.1.0。
- Windows portable 已启动；安装包与校验和见 `release/`。

## 待用户复核

1. 侧边栏/底部导航出现「账房」，`/finance` 页面正常。
2. 快速记一笔、编辑、删除、日期/分类筛选正常。
3. 月度合计、分类占比、近 7 日趋势与明细一致。
4. 导入旅行花费后来源标记正确，重复导入被跳过。
5. 导入前后旅行账本不变。
6. 手机窄屏无横向溢出，金额输入和按钮可正常操作。

## 明确未做

- 不接支付、转账、银行卡、金融 API。
- 不做云同步、账号或遥测。
- 不做预算告警、自动分类、OCR 票据识别。

## 已知限制

- v1.1.0 暂不提供备份/恢复、回收站、自定义分类、本地 PIN、提醒和 CSV/PDF 导出。
- 当前 Android release APK 使用 debug keystore 签名，仅供内部试用；正式分发需独立 release keystore。
- Windows 安装包未做商业代码签名，SmartScreen 可能提示未知发布者。
