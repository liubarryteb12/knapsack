/**
 * 最小 ModRegistry：宿主只负责登记模块、导航入口和本机开关。
 * 业务代码仍放在各 mod 目录，暂不强行搬迁已验收的旅行模块。
 */
import { reactive } from 'vue'

export type ModId = 'trip' | 'daily' | 'finance'

export interface ModManifest {
  id: ModId
  name: string
  navLabel: string
  route: string
  description: string
  defaultEnabled: boolean
}

export const MOD_MANIFESTS: ModManifest[] = [
  {
    id: 'trip',
    name: '旅行',
    navLabel: '旅行',
    route: '/',
    description: '行程、预算、行李与面对面团队协作',
    defaultEnabled: true,
  },
  {
    id: 'daily',
    name: '日常规划',
    navLabel: '每日',
    route: '/daily',
    description: '每日计划、随手备忘与结构化复盘',
    defaultEnabled: true,
  },
  {
    id: 'finance',
    name: '日常账房',
    navLabel: '账房',
    route: '/finance',
    description: '本地花费记录、趋势与消费结构分析',
    defaultEnabled: true,
  },
]

const STORAGE_KEY = 'knapsack.mod-state.v1'

function loadState(): Record<ModId, boolean> {
  const defaults = Object.fromEntries(
    MOD_MANIFESTS.map((m) => [m.id, m.defaultEnabled]),
  ) as Record<ModId, boolean>
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<Record<ModId, unknown>>
    for (const m of MOD_MANIFESTS) {
      if (typeof parsed[m.id] === 'boolean') defaults[m.id] = parsed[m.id] as boolean
    }
  } catch {
    // 损坏的本地开关不阻塞启动，回到默认值。
  }
  return defaults
}

export const modState = reactive<Record<ModId, boolean>>(loadState())

export function setModEnabled(id: ModId, enabled: boolean): void {
  modState[id] = enabled
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...modState }))
  } catch {
    // 存储不可用时仍保留当前会话内的开关状态。
  }
}

export function isModEnabled(id: ModId): boolean {
  return modState[id]
}

export function enabledMods(): ModManifest[] {
  return MOD_MANIFESTS.filter((m) => modState[m.id])
}
