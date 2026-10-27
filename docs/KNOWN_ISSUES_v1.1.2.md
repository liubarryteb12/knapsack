# 行囊 Knapsack v1.1.2 已知问题

- Android release 当前仍使用 debug keystore 签名，仅适合内部试用；正式分发前必须替换独立 release keystore。
- Windows 安装包未做商业代码签名，SmartScreen 可能提示未知发布者。
- v1.1.2 尚未完成真机安装复核；当前验证覆盖构建、回归、边界审计和 Web 产物，用户可自行决定是否安装。
- 回收站、自定义分类、本地 PIN、提醒和 CSV/PDF 导出仍未实现。
- 旅行长列表采用摘要 + 有界分页，不是第三方虚拟滚动库；视觉上会显示分页而不是无限滚动。
