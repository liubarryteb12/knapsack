# 行囊 Knapsack

本地优先的模块化个人生活系统。数据默认保存在本机，无账号、不上传数据到云端、不收集使用数据、不提供云同步。

- [用户使用教程](docs/USER_GUIDE.md)
- [开发者指南](docs/DEVELOPER_GUIDE.md)
- [发布版本](https://github.com/liubarryteb12/knapsack/releases)

## 功能

- 旅行：行程安排、预算与分摊、行李清单、旅行备忘、单文件导出导入
- 每日：任务与时间块、随手备忘、每日复盘、昨日未完成任务顺延
- 账房：本地花费记录、月度预算、分类统计、旅行花费导入
- 目标：目标 → 里程碑 → 任务拆解、AI 拆解向导、灵感池、思维导图（单目标聚焦与多目标合成，可导出 SVG / PNG / Markdown / OPML）
- 提示词库：工作、生图、生视频提示词，变量填充、词块、筛选、速存与分享
- 团队分享：群组与名册、跨模块标准包、二维码收发、版本对比与审核后合入
- 设置：主题、模块开关、本地备份恢复、AI 接口配置
- 局域网会话：同一 WiFi 下的设备互传一份旅行

## 安装

从 [GitHub Releases](https://github.com/liubarryteb12/knapsack/releases) 下载对应平台的安装包：

- Windows：`-setup.exe` 安装版，或 `-portable.exe` 免安装版
- Android：`.apk`，支持 Android 7.0 及以上。首次安装时，系统可能要求允许当前来源安装应用

当前安装包适合内部试用。若系统提示未知发布者，请先确认文件来源可信。

## 使用

完整操作步骤见 [用户使用教程](docs/USER_GUIDE.md)。

## 数据与隐私

- 核心数据默认只保存在当前设备。
- 无账号、不上传数据到云端、不收集使用数据、不提供云同步。
- AI 功能只会请求你配置的 AI 服务。
- 天气功能只在你主动查询时请求外部天气服务 Open-Meteo。
- 局域网会话和团队二维码只连接同一现场的附近设备。
- 应用不提供支付、转账、银行卡或其他金融接口。

卸载应用或清除应用数据会删除本机内容。重要数据请定期使用“设置 → 本地备份”导出备份。

## 版本与问题

- 各版本更新说明见 [GitHub Releases](https://github.com/liubarryteb12/knapsack/releases)
- v1.1–v1.4 的历史版本文档（发布说明、已知问题、发布门禁、过程评审）保留在 [`legacy/v1.x-docs`](https://github.com/liubarryteb12/knapsack/tree/legacy/v1.x-docs) 分支，主分支不再维护

## 开源协议

本项目采用 MIT License，详见 [LICENSE](LICENSE)。
