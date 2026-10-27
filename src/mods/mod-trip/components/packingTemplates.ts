/** 内置行李模板：city/beach/mountain/generic 四套，套用 = 追加分组 */

export interface PackingTemplateGroup {
  group: string
  items: string[]
}

export interface PackingTemplate {
  icon: string
  label: string
  groups: PackingTemplateGroup[]
}

const commonGroups: PackingTemplateGroup[] = [
  {
    group: '证件',
    items: ['身份证', '手机', '充电器', '充电宝', '现金/银行卡'],
  },
  {
    group: '洗漱',
    items: ['牙刷', '牙膏', '毛巾', '洗发水', '沐浴露', '护肤品'],
  },
  {
    group: '药品',
    items: ['感冒药', '肠胃药', '创可贴', '晕车药'],
  },
]

export const packingTemplates = {
  city: {
    icon: '🏙️',
    label: '城市',
    groups: [
      ...commonGroups,
      { group: '衣物', items: ['换洗衣物', '外套', '舒适的运动鞋', '雨伞'] },
      { group: '电子', items: ['耳机', '相机', '数据线'] },
    ],
  },
  beach: {
    icon: '🏖️',
    label: '海边',
    groups: [
      ...commonGroups,
      { group: '衣物', items: ['泳衣', '沙滩裤', '防晒衣', '拖鞋', '遮阳帽'] },
      { group: '防晒', items: ['防晒霜', '晒后修复', '太阳镜', '遮阳伞'] },
      { group: '装备', items: ['防水袋', '浮潜面镜', '沙滩垫'] },
    ],
  },
  mountain: {
    icon: '⛰️',
    label: '山野',
    groups: [
      ...commonGroups,
      { group: '衣物', items: ['速干衣', '抓绒/冲锋衣', '登山鞋', '登山杖', '帽子'] },
      { group: '装备', items: ['背包', '头灯', '水壶', '能量食品', '雨衣'] },
      { group: '安全', items: ['手台/哨子', '急救包', '防蚊液', '保暖毯'] },
    ],
  },
  generic: {
    icon: '🎒',
    label: '通用',
    groups: [
      ...commonGroups,
      { group: '衣物', items: ['换洗衣物', '外套', '舒适的鞋'] },
      { group: '其他', items: ['纸巾', '湿巾', '塑料袋', '小背包'] },
    ],
  },
} satisfies Record<string, PackingTemplate>
