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
- AI 行程草稿（可选）：OpenAI 兼容接口生成行程，Zod 校验 + 失败回喂重试 1 次，预览确认后只能保存为新旅行，绝不覆盖现有数据；断网时按钮置灰
- 天气（可选）：Open-Meteo 查行程日期内预报，显示在行程页顶部；离线或失败时整个区域静默隐藏

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

后续规划：Tauri 2 桌面打包（Windows）、Capacitor 安卓打包、局域网会话共享。
