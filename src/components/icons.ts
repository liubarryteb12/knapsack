/**
 * 图标统一出口：业务语义 → Lucide 图标组件。
 *
 * 页面不直接 import 图标包，都从这里拿；想换图标库只改这一个文件。
 * 全局样式约定 --type-<type> / --type-<type>-soft 两个变量配套使用。
 */
import type { Component } from 'vue'
import {
  Backpack,
  Map,
  Settings,
  TrainFront,
  BedDouble,
  Utensils,
  Ticket,
  Pin,
  Umbrella,
  Mountain,
  Shrub,
  Building2,
} from '@lucide/vue'
import type { DestType, ItemType } from '../schema/trip'

export {
  Backpack,
  Map,
  Settings,
  TrainFront,
  BedDouble,
  Utensils,
  Ticket,
  Pin,
  Umbrella,
  Mountain,
  Shrub,
  Building2,
}

/** 行程条目 / 花费分类 → 图标（交通/住宿/餐饮/游玩/其他） */
export const typeIcon: Record<ItemType, Component> = {
  transport: TrainFront,
  stay: BedDouble,
  food: Utensils,
  play: Ticket,
  other: Pin,
}

/** 目的地类型 → 图标（城市/海边/山野/通用） */
export const destTypeIcon: Record<DestType, Component> = {
  city: Building2,
  beach: Umbrella,
  mountain: Mountain,
  generic: Shrub,
}
