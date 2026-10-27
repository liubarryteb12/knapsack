# 行囊 Knapsack v1.3.0 已知问题

- Android release 仍使用 debug keystore 签名，仅适合内部试用。正式分发前必须替换独立 release keystore。
- Windows 安装包和 portable 未做商业代码签名，SmartScreen 可能提示未知发布者。
- `ShareablePackage` 的 SHA-256 是内容完整性摘要，不是无密钥摘要层面的身份认证。作者身份与团长批准由本机界面审核流程承担。
- 分享版本链记录在本机 localStorage。清除应用数据会丢失版本链；若业务表仍有同主键记录，协同导入会失败关闭并拒绝覆盖。
- 提示词共享包包含条目和引用词块，不包含缩略图 Blob。导入时会移除 `coverMediaId`，避免形成悬挂媒体引用。
- 每日计划只读包为避免覆盖本机同名日期，会按顺序写入当前最大日期之后的新日期。
- 多帧分片、乱序重组和二维码生成已有自动化与浏览器验证；两台真机同时进行相机连续实扫仍需现场设备验收。
- 旧 `trips`、`dailyDays`、`financeEntries` 与旧团队表继续保留一个版本用于回滚，尚未执行 contract 删除。
