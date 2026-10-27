# Knapsack v4 微内核实施计划

## 当前 WIP

- [x] V4-01 开放 `ModManifest`、模块发现、自动路由/导航、启停与旧开关键迁移
- [x] V4-02 `CapabilityBus` 与 `SlotManager`，缺失模块统一空值降级
- [x] V4-03 保留 v1-v4 旧表，自动创建 Manifest 声明的 `mod_*` 沙箱表并迁移镜像
- [x] V4-04 现有模块切换到沙箱表读写，旧表保留一个 expand-contract 版本
- [x] P4-T1 `mod-prompts` 模板变量解析、四维分面筛选与三态 Schema
- [x] P4-T2 多方言组合器、词块字典与导入导出
- [x] P4-T3 提示词画廊、Runner、编辑器、缩略图与全局速存插槽
- [x] P4-T4 提示词专项测试、全平台回归、构建和移动端巡检
- [x] V4-05 静态模块边界审计、统一备份中心和敏感字段策略
- [x] V4-06 每日 50 步撤销、时间块拖拽、跨日顺延、复盘插槽
- [x] V4-07 账房最大余额法、旅行净实付、双轴结构与预算水位
- [x] V4-08 旅行模块物理收敛与 `TripLedgerExporter`
- [x] V5-01 `mod-team` 独立卡带、`ShareablePackage` 协议与 LanShare 通用分包
- [x] V5-02 旅行/提示词/每日计划跨模块打包、版本链与受控合入
- [x] V5-03 团队分享工作台、权限模式、动态二维码收发与 Diff 审核
- [x] V5-04 三个业务模块分享闭环、全平台回归与 1.3.0 双端交付

## 验收门禁

1. 新增 `src/mods/mod-*/manifest.ts` 后，仅运行 `npm run mod:sync` 和构建即可出现路由、导航、设置项与私有表，不修改 `src/core/`。
2. 任一模块关闭后，能力查询返回 `[]`，插槽贡献卸载，历史表与数据保留。
3. v1-v4 数据升级时旧表不删除，`mod_*` 镜像内容一致；迁移失败时 Dexie 升级事务整体回滚。
4. `src/core/` 与 `src/engines/` 不得导入 `src/mods/*`；模块之间不得直接导入兄弟模块。
5. 跨模块数据只通过 CapabilityBus 或 SlotManager；金额只用整数分，日期只用本地 `YYYY-MM-DD`。
6. 每个切片执行专项测试、`npm run build`、`npm run audit:boundary`，共享层改动再加全平台回归。

## 测试命令

```powershell
npm run mod:sync
npm run build
npm run audit:boundary

node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-mod-registry-export.ts
node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-sandboxed-db.ts
```

`scripts/lib/tsx-preload.mjs` 只绕过当前 Windows 环境 `uv_os_get_passwd ENOMEM` 的运行器故障，不改变业务断言。

## 兼容边界

- 旧 `knapsack` 数据库名与旧表在本阶段保留，供升级、回滚和故障取证使用。
- 新代码统一读写 `mod_*` 表；旧表停止写入，但不在本版本删除。
- 团队配对凭证和 `credentialSecret` 不进入明文备份；备份中心实现前必须完成字段级策略。

## 当前证据

- `npm test`：37 个测试文件通过，覆盖备份、微内核、三模块业务、分享协议、版本守卫、团队协作、提示词、数据库迁移与边界逻辑。
- `npm run build`：Vue 类型检查和 Vite 生产构建通过。
- `npm run audit:boundary`：动态校验版本、Tauri/Android、产物、清单、SHA-256、网络边界与资产同步。
- `npm run audit:modules`：0 个单向依赖失败，0 个旅行 facade 警告。
- 390px 浏览器实测：团队工作台、只读/协同装箱、分片二维码、Diff 页与底部导航可用，弹窗高度受控。
- 分享包的 SHA-256 负责内容完整性；作者身份和团长批准由本地审核流程承担，不宣称无密钥摘要具备身份认证能力。
- Windows NSIS 1.3.0 已安装并启动；两台 Android 设备均回读 `1.3.0 (6)`；六个发布产物通过 SHA-256 复算。
- 旅行 Schema、结算、摘要、页面、业务组件、store、团队域与团队 DB action 已进入 `src/mods/mod-trip/`；LAN session 与扫码器进入 `src/engines/lan-share-engine/`。旧路径只保留兼容 facade。
