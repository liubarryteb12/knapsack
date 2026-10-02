# 行囊 Knapsack

离线优先的个人旅行规划应用。数据 100% 存本地（IndexedDB），无账号、无服务器、无遥测、无云同步。

核心气质：轻量。统一条目模型、整数分记账、`.trip` 单文件交换格式。

## 当前功能

- 旅行管理：新建/复制/删除/导出导入 `.trip` 文件（导入前强制校验，覆盖或另存二选一）
- 行程时间轴：按天组织，条目含时间/类型/标题/备注/完成勾选，支持天内拖拽排序与跨天移动，撤销栈 50 步
- 预算与花费：总预算、花费记录（付款人 + 均分/按份/自定义三种分摊）、结算建议（净额贪心算法）、花费合并导入（按 id 去重）
- 行李清单：城市/海边/山野/通用四套内置模板，自定义分组与条目，打包进度
- 备忘录：自由文本，停止输入 1 秒自动保存
- 模块开关：按旅行控制预算/备忘模块显隐
- 外观：浅色 / 深色 / 跟随系统三档主题，选择只存本机；首屏前置应用主题，深色下不闪白
- AI 行程草稿（可选）：OpenAI 兼容接口生成行程，Zod 校验 + 失败回喂重试 1 次，预览确认后只能保存为新旅行，绝不覆盖现有数据；断网时按钮置灰
- 天气（可选）：Open-Meteo 查行程日期内预报，显示在行程页顶部；离线或失败时整个区域静默隐藏
- 局域网会话（可选）：同一 WiFi 下 PC 当主机、手机扫码接入，AES-256-GCM 加密、整份覆盖式双向同步一份行程，不经过任何服务器

## 安装与运行

```bash
npm install
npm run dev      # 开发调试 http://localhost:5173
npm run build    # 类型检查 + 产物构建
```

需要 Node 20+。

## 数据格式 trip.v1

每个旅行计划是一个 JSON 对象，导出文件后缀 `.trip`（即本 JSON 的美化序列化）：

```jsonc
{
  "format": "trip.v1",              // 格式名+版本号，导入校验第一关
  "id": "V1StGXR8_Z5j",             // 本地主键
  "name": "五一杭州行",
  "startDate": "2026-05-01",        // yyyy-MM-dd
  "endDate": "2026-05-03",
  "destType": "city",               // city / beach / mountain / generic，行李模板用
  "destCity": "杭州",               // 城市名，天气功能用
  "totalBudgetFen": 500000,         // 金额一律整数分：5000.00 元 = 500000
  "categoryBudgetsFen": {},         // 分类预算（可选）

  "members": [                      // 参与人，本地数据，无需注册
    { "id": "m1", "name": "我", "role": "owner" },
    { "id": "m2", "name": "小李", "role": "member" }
  ],

  "days": [
    { "date": "2026-05-01",
      "items": [
        { "id": "i1", "time": "09:00",
          "type": "transport",      // transport / stay / food / play / other
          "title": "高铁去杭州",
          "note": "G7349 虹桥 8:12 开",
          "linkedExpenseId": null, "done": false }
      ] }
  ],

  "expenses": [                     // 无成员时为空且入口隐藏
    { "id": "e1", "date": "2026-05-01", "category": "transport",
      "title": "高铁票", "amountFen": 29200, "payerId": "m1",
      "split": { "mode": "equal", "memberIds": ["m1", "m2"] } }
      // split.mode: equal 均分 / shares 按份 / custom 自定义金额
  ],

  "packing": [
    { "group": "证件", "items": [ { "id": "k1", "label": "身份证", "packed": false } ] }
  ],

  "notes": "",                      // 备忘区，自由文本
  "enabledModules": { "expenses": true, "notes": true }
}
```

硬规则：

- Zod Schema（`src/schema/trip.ts`）是唯一事实源：内部写入、文件导入、AI 返回结果全部先过校验
- 金额一律整数分存储，界面输入元、展示时除以 100，禁止任何浮点金额运算
- 所有 id 用 nanoid 生成；日期 `yyyy-MM-dd`，时间 `HH:mm`
- 导入失败给人话错误提示，绝不静默写入；结算建议不落盘，每次现算

## 开发

```bash
npx tsx scripts/test-settle.ts   # 结算引擎测试（金额守恒/分摊/贪心匹配）
```

技术栈：Vue 3 + TypeScript strict + Vite + Pinia + Vue Router + Dexie(IndexedDB) + Zod + Sortable.js + Naive UI。

## 打包与安装

### Windows 桌面版（Tauri 2）

```bash
npx tauri build                          # 需 Rust + MSVC 工具链
```

产物：

- 安装包 `src-tauri/target/release/bundle/nsis/Knapsack_1.0.0_x64-setup.exe`
- 免安装单文件 `src-tauri/target/release/app.exe`

安装后是独立桌面程序，数据存在本机 IndexedDB，断网全功能可用。

### 安卓版（Capacitor）

前置：**JDK 21**、Android SDK（platform-tools / build-tools / platforms）。
Capacitor 的 Android 模块要求 `sourceCompatibility 21`，用 JDK 17 会报
`错误: 无效的源发行版：21`。

```bash
npm run build                     # 生成 dist/
npx cap sync android              # 把 web 产物与配置同步进 android 工程
cd android
.\gradlew.bat assembleDebug       # Windows；macOS/Linux 用 ./gradlew assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`
（仓库另拷了一份到 `release/Knapsack-debug.apk`，`release/` 不入库）

应用信息：包名 `com.liubarryteb12.knapsack`，minSdk 24（Android 7.0+），targetSdk 36。

首次构建需联网下载 Gradle 与依赖。走代理时在 `~/.gradle/gradle.properties` 里加：

```properties
systemProp.http.proxyHost=127.0.0.1
systemProp.http.proxyPort=7890
systemProp.https.proxyHost=127.0.0.1
systemProp.https.proxyPort=7890
```

生成 Release 签名包（可选）：`keytool` 生成 keystore → 在
`android/app/build.gradle` 配 `signingConfigs.release` → `.\gradlew.bat assembleRelease`。

## 红米 K40（HyperOS / MIUI）安装与保活设置

K40 的系统默认限制后台与自启动，还拦截 adb/未知来源安装。按顺序做一遍，
避免「用着用着数据像丢了」。

### 1. 允许安装（安装前必做）

`设置 → 更多设置 → 开发者选项`：

- 打开 **「USB 调试」**
- 打开 **「USB 调试（安全设置）」/「通过 USB 安装」** —— 不开这一步，用数据线
  `adb install` 会报 `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`

直接用手机装 APK 时，首次会提示“已屏蔽安装未知应用”，点「设置」→ 允许该来源即可。

### 2. 关闭电池优化（必须）

`设置 → 应用设置 → 应用管理 → 行囊 Knapsack → 省电策略` → 选 **无限制**
（不要选“智能限制后台运行”或“后台运行超过 10 分钟关闭”）。

### 3. 允许自启动与后台弹出（必须）

`设置 → 应用设置 → 应用管理 → 行囊 Knapsack → 权限管理`：

- 打开「自启动」
- 打开「后台弹出界面」（否则从别的应用切回来可能黑屏）
- 「显示悬浮窗」按需开启

再到 `设置 → 应用设置 → 授权管理 → 自启动管理`，确认 Knapsack 在允许列表内。

### 4. 锁定最近任务

打开多任务卡片视图，把 Knapsack 卡片**下拉或点小锁图标**锁定，防止一键清理时被清掉。

### 5. 关掉省电模式与「不保留活动」

`设置 → 电池 → 省电模式` 关闭；开发者选项里的「不保留活动」也要关，否则切后台即被销毁。

### 6. 数据安全提醒

- 数据存在 IndexedDB，**卸载应用会连数据一起删除**。重要行程随手用「导出 .trip」备份到手机存储或发给自己。
- `设置 → 应用管理 → 行囊 Knapsack → 清除数据` 同样会清空行程，非必要不要点。

## 局域网会话（多设备同步）

同一 WiFi 下，把 PC（Tauri 桌面版）当主机，手机扫码接入，双向同步一份行程。
不经过任何服务器，全程只有两台设备互连。

### 用法

主机（PC 桌面版）：

1. 打开某个行程 → 右上角「🔗 局域网会话」
2. 面板里显示二维码；多网卡时可在下拉里切换 IP（默认首选内网地址）
3. 保持面板打开（关闭面板即结束会话）

接入方（手机）：

1. 打开同一行程 → 「🔗 局域网会话」
2. 点「扫码加入」扫 PC 上的二维码；或把会话码粘贴进输入框后点「连接」
3. 连上后二选一：
   - 「从主机拉取（覆盖本地）」——用主机版本覆盖本机
   - 「把我的版本推给主机」——把本机版本推给主机

### 同步语义

- **整份覆盖**，不做字段级合并：拉取 / 推送都是拿一份完整 `trip.v1` 覆盖对方
- 覆盖前先把本地旧版本压入撤销栈，随时可撤销
- 主机面板关闭即结束会话，接入方的连接随之失效

### 安全模型

- 传输走局域网**明文 HTTP**，机密性由**应用层加密**保证：
  载荷用 **AES-256-GCM** 信封加密，线格式 `nonce(12B) || 密文 || tag(16B)`
- 会话密钥 32 字节随机生成，**只出现在二维码/会话码里**，不经网络明文传输；
  同一 WiFi 下嗅探只能看到密文
- 主机对每个 `/pull`、`/push` 都先验 tag 再处理，密钥不对直接拒绝
- 会话码里含密钥，**别截图外发**；结束会话（关面板）后密钥即失效

### 协议

- 应用标识 `knapsack-session/1`
- 端点：`GET /info`（取主机行程名，便于接入方确认连对了人）、`POST /pull`、`POST /push`
- 会话码（二维码内容）格式：

  ```text
  knapsack-session/1?ip=<主机IP>&port=<端口>&k=<base64url 会话密钥>&s=<会话号>
  ```

- Rust 侧（`src-tauri/src/session.rs`）与前端（`src/utils/lanSessionProtocol.ts`）
  共用同一线格式，跨语言 KAT 对拍测试保证两种实现互解（见 `scripts/test-lansession.ts`）
- 安卓端要在 WebView 里访问明文 `http://`，已在 `capacitor.config.ts`
  （`server.cleartext`、`allowMixedContent`）与 `AndroidManifest.xml`
  （`usesCleartextTraffic`）放开；安全性由上面的 AES-GCM 保证，而非 TLS

### 真机联调

仓库内置一个开发主机，不依赖 Tauri 外壳，直接在局域网里起真实服务：

```bash
cd src-tauri
cargo test --lib dev_host -- --ignored --nocapture   # 起服务并打印会话码，挂住 10 分钟
```

把打印出的会话码粘到手机端「局域网会话」里即可走真实网络路径；收到手机推送时会实时打印。

## 后续规划

- 统一空状态与错误提示文案
- 可选暗色主题
- 打包 v1.0（Windows NSIS 安装包 + 安卓 APK）
