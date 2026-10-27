# 行囊 Knapsack v1.2.0 已知问题

- Android 仍使用 debug keystore 签名，仅适合内部试用。正式分发前必须替换独立 release keystore。
- Windows 安装包未做商业代码签名，SmartScreen 可能提示未知发布者。
- 本轮已将 Android 包安装到 Redmi K20 Pro。K40 虽在线，但本轮未覆盖安装。
- 团队配对凭证和 `credentialSecret` 不进入明文备份，恢复备份后需要重新配对。
- 旧 `trips`、`dailyDays`、`financeEntries` 与团队表仍保留一个版本用于回滚，尚未执行 contract 删除。
