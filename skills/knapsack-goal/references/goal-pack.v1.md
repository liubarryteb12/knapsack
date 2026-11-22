# goal-pack.v1 字段说明

与 Knapsack `src/mods/mod-goals/schema.ts` 逐条对应。任何改动都必须两侧同步并升级 `schemaVersion`。

## 顶层

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `format` | `"goal-pack.v1"` | 是 | 固定值 |
| `schemaVersion` | `1` | 是 | 固定值 |
| `source` | `"claude-desktop" \| "knapsack-ai" \| "manual"` | 是 | 产出方 |
| `createdAt` | ISO 8601 字符串 | 是 | 生成时间 |
| `assumptions` | `string[]` | 否 | AI 在信息不足时做出的假设 |
| `ideas` | 数组 | 否 | 想法 |
| `goals` | 数组 | 否 | 目标，内含里程碑与任务 |
| `cycles` | 数组 | 否 | 周期安排 |

`ideas`、`goals`、`cycles` 至少有一项非空。

## ideas[]

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `externalId` | kebab-case 字符串 | 是 | 全包唯一，稳定不变 |
| `title` | string | 是 | 想法标题 |
| `raw` | string | 否 | 原始描述或讨论纪要 |
| `status` | `raw \| clarified \| promoted \| parked` | 否 | 默认 `raw` |
| `tags` | `string[]` | 否 | 标签 |
| `source` | 同顶层 source | 否 | 默认 `manual` |
| `goalExternalId` | string | 否 | 晋级出的目标，必须能在本包或本地找到 |

## goals[]

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `externalId` | kebab-case | 是 | 全包唯一 |
| `title` | string | 是 | 目标标题 |
| `why` | string | 否 | 为什么做，一句话 |
| `successCriteria` | string | 否 | 总体验收口径 |
| `horizon` | `quarter \| half-year \| year \| open` | 否 | 默认 `quarter` |
| `startDate` | `yyyy-MM-dd` | 是 | 开始日期 |
| `targetDate` | `yyyy-MM-dd` | 否 | 截止日期，不得早于开始 |
| `status` | `draft \| active \| paused \| done \| abandoned` | 否 | 默认 `draft` |
| `priority` | `1 \| 2 \| 3` | 否 | 1 最高，默认 2 |
| `milestones` | 数组 | 否 | 最多 6 个 |

### goals[].milestones[]

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `externalId` | kebab-case | 是 | 全包唯一 |
| `title` | string | 是 | 里程碑标题 |
| `acceptance` | string | 是 | 可验证的验收口径，不能为空 |
| `targetDate` | `yyyy-MM-dd` | 否 | |
| `status` | `todo \| active \| done \| missed` | 否 | 默认 `todo` |
| `order` | 整数 ≥ 0 | 否 | 从 0 开始 |
| `tasks` | 数组 | 否 | 一级任务最多 5 个 |

### goals[].milestones[].tasks[]

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `externalId` | kebab-case | 是 | 全包唯一 |
| `title` | string | 是 | 动词开头、可独立执行 |
| `detail` | string | 否 | 补充说明 |
| `estimate` | `S \| M \| L` | 否 | 默认 `M` |
| `dueDate` | `yyyy-MM-dd` | 否 | |
| `cycleExternalId` | string | 否 | 指向本包或本地周期 |
| `status` | `todo \| doing \| done \| dropped` | 否 | 默认 `todo` |
| `order` | 整数 ≥ 0 | 否 | 同级内排序 |
| `children` | 数组 | 否 | 子任务，结构与父任务相同，可继续嵌套；省略等价于空数组 |

## cycles[]

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `externalId` | kebab-case | 是 | 全包唯一 |
| `goalExternalId` | string | 是 | 所属目标，必须可解析 |
| `label` | string | 是 | 如「2026-11 第 4 周」 |
| `startDate` | `yyyy-MM-dd` | 是 | |
| `endDate` | `yyyy-MM-dd` | 是 | 不得早于开始 |
| `focus` | string | 否 | 这个周期的聚焦点 |

## 规模上限

| 项 | 上限 |
|---|---|
| 目标数 | 20 |
| 每目标里程碑 | 6 |
| 每里程碑一级任务 | 5 |
| 单个父任务下子任务 | 5 |
| 任务层级深度（里程碑算第 1 级） | 5 |
| 每里程碑任务总数（含子任务、孙任务） | 25 |
| 周期数 | 10 |

超限会被整包拒绝，不会截断。层级和总量按整棵树统计。

## 导入规则（写给理解行为的人）

- 匹配只按 `externalId`，与 `source` 无关
- 命中即更新内容字段；本地已有的 `status` 永远不会被覆盖
- 本包未包含的里程碑/任务不会被删除
- 同一份包重复导入会被提示，二次确认后才写入

## 完整示例

```json
{
  "format": "goal-pack.v1",
  "schemaVersion": 1,
  "source": "claude-desktop",
  "createdAt": "2026-11-19T08:00:00.000Z",
  "assumptions": ["未提供每周可投入时间，按每周 10 小时估算"],
  "ideas": [
    {
      "externalId": "idea-weekly-writing",
      "title": "每周稳定写一篇",
      "raw": "想稳定输出公众号文章，但总断更。",
      "status": "clarified",
      "tags": ["公众号"],
      "source": "claude-desktop",
      "goalExternalId": "goal-weekly-writing"
    }
  ],
  "goals": [
    {
      "externalId": "goal-weekly-writing",
      "title": "连续 8 周每周产出 1 篇",
      "why": "为公众号积累选题和读者信任",
      "successCriteria": "8 周内发布 8 篇，至少 3 篇阅读量高于账号均值",
      "horizon": "quarter",
      "startDate": "2026-11-24",
      "targetDate": "2027-01-18",
      "status": "active",
      "priority": 1,
      "milestones": [
        {
          "externalId": "ms-topic-bank",
          "title": "建立选题库",
          "acceptance": "至少有 20 个可写选题，每个附一句切入角度",
          "targetDate": "2026-12-07",
          "status": "todo",
          "order": 0,
          "tasks": [
            {
              "externalId": "task-collect-topics",
              "title": "收集 20 个读者常见问题",
              "detail": "",
              "estimate": "M",
              "status": "todo",
              "order": 0,
              "cycleExternalId": "cycle-w1",
              "children": [
                {
                  "externalId": "task-reader-questions",
                  "title": "翻最近 30 天读者留言",
                  "estimate": "S",
                  "status": "todo",
                  "order": 0
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "cycles": [
    {
      "externalId": "cycle-w1",
      "goalExternalId": "goal-weekly-writing",
      "label": "2026-11 第 4 周",
      "startDate": "2026-11-23",
      "endDate": "2026-11-29",
      "focus": "搭好选题库骨架"
    }
  ]
}
```

## 常见错误

| 错误 | 后果 | 修正 |
|---|---|---|
| externalId 用了中文或下划线 | 整包被拒 | 改成英文 kebab-case |
| 里程碑没写 acceptance | 整包被拒 | 补一句可验证的口径 |
| 任务写成「推进项目」 | 能导入但不可执行 | 改成动词开头的具体动作 |
| 日期写成 2026/11/24 | 被拒 | 改成 `2026-11-24` |
| cycleExternalId 指向不存在的周期 | 被拒 | 保证引用对象在本包中 |
| 编造用户没说过的数字 | 违反假设规则 | 写进 assumptions |
