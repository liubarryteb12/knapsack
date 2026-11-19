# 行囊 Knapsack v1.4.0 已知问题

- Android release 仍使用 debug keystore 签名，仅适合内部试用。正式分发前必须替换独立 release keystore。
- Windows 安装包和 portable 未做商业代码签名，SmartScreen 可能提示未知发布者。
- 目标模块的 AI 拆解依赖「设置」里的 OpenAI 兼容接口；未配置或接口不可用时只能手工录入或用 goal-pack 导入。
- 两轮拆解的结果质量取决于所配置的模型；模型可能给出偏大的里程碑或不可执行的任务，需要在预览页人工判断。
- `goal-pack.v1` 按 `externalId` 匹配，导入方不做身份认证；来源不可信的包应先看预览再确认。
- 目标模块暂不与每日规划、账房联动，任务不会自动出现在「今日计划」里。
- 本地构建需要 Rust 1.90（`src-tauri/rust-toolchain.toml`）、MSVC 工具链与 Windows SDK；Android 需要 JDK 21。1.99 的 Rust 无法编译 `memchr 2.8.3`。
