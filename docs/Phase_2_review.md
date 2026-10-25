# Phase 2 · mod-daily 审查包

日期：2026-10-23
状态：核心闭环完成，等待用户真机 UI 复核

## 本轮交付

- `src/core/modRegistry.ts`：最小模块注册表，登记旅行/日常模块，支持本机开关。
- `src/mods/mod-daily/schema.ts`：`daily-day.v1` schema，任务、时间块、备忘和三问复盘。
- `src/mods/mod-daily/store.ts`：按日期加载、任务 CRUD、自动保存和日期隔离。
- `src/mods/mod-daily/DailyView.vue`：`/daily` 页面，含日期切换、任务列表、备忘和复盘。
- `src/db/index.ts`：IndexedDB 升级到 v3，新增 `dailyDays` 表。
- `src/router/index.ts`、`src/App.vue`、`src/views/SettingsView.vue`：路由、导航和模块开关接入。
- `scripts/test-daily.ts`：schema、ModRegistry、日期隔离、CRUD、持久化回归。

## 验证证据

- `npx tsx scripts/test-daily.ts`：23 条断言全部通过。
- 全部 12 个测试脚本：退出码 0。
- `npm run build`：`vue-tsc --noEmit` 与 Vite 构建通过。
- 本地浏览器冒烟：页面渲染、添加任务、备忘自动保存、刷新恢复通过；测试数据已清理。

## 待用户复核

1. 侧边栏/底部导航出现「每日」，`/daily` 页面正常。
2. 新增任务、填写时间、勾选完成、编辑和删除任务。
3. 前后切换日期，任务/备忘/复盘互不串。
4. 备忘停止输入后自动保存，刷新后恢复。
5. 三问复盘保存后恢复，空内容不报错。
6. 设置关闭「日常规划」后入口隐藏，再开启恢复。
7. 手机窄屏无横向溢出。

## 明确未做

- 未实现 Phase 3 记账模块。
- 未做云同步、账号、遥测或支付。
- 未做每日模块的文件导入导出和跨模块统计联动。
- 未做提醒通知、后台任务或系统日历集成。
