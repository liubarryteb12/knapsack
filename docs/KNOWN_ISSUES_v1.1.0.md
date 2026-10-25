# 行囊 Knapsack v1.1.0 已知问题

## 数据安全

- 暂未提供全量本地备份/恢复；卸载应用或清除数据会丢失 IndexedDB。重要数据请先保留原始 `.trip` 导出。
- 每日任务和账房记录暂未提供回收站/撤销删除。

## 功能边界

- 账房暂不支持自定义分类、标签、CSV/PDF 导出、收据照片附件。
- 暂不支持本地提醒、周期账单、习惯打卡、多币种。
- 暂不支持本地 PIN 或全库加密。
- AI/天气为可选外部请求；不使用时不触发对应网络路径。

## 分发

- 当前 Android release APK 使用 debug keystore 签名，仅供内部试用；正式分发必须替换独立 release keystore。
- Windows 安装包未做商业代码签名，可能出现 SmartScreen 提示。
- Windows portable 的数据目录和卸载行为尚未做完整跨机器验证。

## 验证范围

- 已完成 14 个自动化脚本、Web/Android/Tauri 构建、Android release 安装和 Windows portable 启动。
- 真实用户 3–5 人的顺手度试用尚未完成。
