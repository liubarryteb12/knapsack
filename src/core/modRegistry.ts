import { reactive } from 'vue'
import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { CapabilityBus, type CapabilityProvider, type CapabilityTopic } from './capabilityBus'
import { SlotManager } from './slotManager'

export type ModId = `mod-${string}`
export type ModSlotName = `${string}:${string}`
export type ModDbStoreName = `mod_${string}`

export interface ModDbIndex {
  name: string
  keyPath: string | string[]
  unique?: boolean
  multi?: boolean
}

export interface ModDbStore {
  /** Physical IndexedDB store name. Host validates the mod_ namespace prefix. */
  name: ModDbStoreName
  keyPath: string | string[]
  indexes?: readonly ModDbIndex[]
  /** One-release expand-contract bridge from a pre-v4 table. */
  legacyName?: string
  /** Ordered migration sources; later sources overwrite earlier ones. */
  legacyNames?: readonly string[]
}

export interface ModNavItem {
  label: string
  to: string
  icon: Component
  order: number
  /** Additional route prefixes that should keep this navigation item active. */
  activePaths?: readonly string[]
}

export interface ModSlotContribution {
  targetSlot: ModSlotName
  component: Component
  order?: number
  props?: Record<string, unknown>
}

export interface HostContext {
  manifest: ModManifest
  capabilities: CapabilityBus
  slots: SlotManager
}

export interface ModManifest {
  id: ModId
  name: string
  version: string
  /** Bump when this module changes its dbStores declaration. */
  schemaRevision: number
  description: string
  enabledByDefault: boolean
  dbStores: readonly ModDbStore[]
  routes: readonly RouteRecordRaw[]
  navItems: readonly ModNavItem[]
  slotContributions?: readonly ModSlotContribution[]
  providesCapabilities?: Partial<Record<CapabilityTopic, CapabilityProvider>>
  onActivate?: (ctx: HostContext) => Promise<void> | void
  onDeactivate?: () => Promise<void> | void
}

export interface EnabledNavItem extends ModNavItem {
  modId: ModId
}

const MOD_ID_PATTERN = /^mod-[a-z0-9]+(?:-[a-z0-9]+)*$/
const STORE_NAME_PATTERN = /^mod_[a-z0-9]+(?:_[a-z0-9]+)+$/
const STORAGE_KEY = 'knapsack.mod-state.v1'

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label}不能为空`)
}

export function validateModManifests(input: readonly ModManifest[]): ModManifest[] {
  const ids = new Set<string>()
  const storeNames = new Set<string>()
  const routePaths = new Set<string>()
  for (const manifest of input) {
    if (!MOD_ID_PATTERN.test(manifest.id)) throw new Error(`非法模块 ID：${manifest.id}`)
    if (ids.has(manifest.id)) throw new Error(`模块 ID 重复：${manifest.id}`)
    ids.add(manifest.id)
    assertNonEmpty(manifest.name, `${manifest.id} 名称`)
    assertNonEmpty(manifest.version, `${manifest.id} 版本`)
    if (!Number.isInteger(manifest.schemaRevision) || manifest.schemaRevision < 0) {
      throw new Error(`${manifest.id} schemaRevision 必须是非负整数`)
    }
    for (const store of manifest.dbStores) {
      if (!STORE_NAME_PATTERN.test(store.name)) {
        throw new Error(`${manifest.id} 存储表 ${store.name} 缺少合法的 mod_ 沙箱前缀`)
      }
      if (storeNames.has(store.name)) throw new Error(`存储表重复声明：${store.name}`)
      storeNames.add(store.name)
      if (store.legacyName !== undefined) assertNonEmpty(store.legacyName, `${store.name} legacyName`)
      for (const legacyName of store.legacyNames ?? []) {
        assertNonEmpty(legacyName, `${store.name} legacyNames`)
      }
    }
    for (const route of manifest.routes) {
      assertNonEmpty(route.path, `${manifest.id} 路由路径`)
      if (routePaths.has(route.path)) throw new Error(`路由路径重复：${route.path}`)
      routePaths.add(route.path)
    }
    for (const item of manifest.navItems) {
      assertNonEmpty(item.label, `${manifest.id} 导航标签`)
      assertNonEmpty(item.to, `${manifest.id} 导航地址`)
      if (!Number.isFinite(item.order)) throw new Error(`${manifest.id} 导航 order 必须是数字`)
    }
  }
  return [...input]
}

function loadState(manifests: readonly ModManifest[], storage?: Storage): Record<string, boolean> {
  const state = Object.fromEntries(
    manifests.map((manifest) => [manifest.id, manifest.enabledByDefault]),
  )
  if (!storage) return state
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return state
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const manifest of manifests) {
      const legacyKey = manifest.id.slice('mod-'.length)
      const value = parsed[manifest.id] ?? parsed[legacyKey]
      if (typeof value === 'boolean') state[manifest.id] = value
    }
  } catch {
    // A corrupted preference must not prevent the host from booting.
  }
  return state
}

export class ModRegistry {
  readonly manifests: ModManifest[]
  readonly state: Record<string, boolean>
  readonly capabilities = new CapabilityBus()
  readonly slots = new SlotManager()
  private readonly storage?: Storage
  private readonly activated = new Set<ModId>()

  constructor(manifests: readonly ModManifest[], storage?: Storage) {
    this.manifests = validateModManifests(manifests).sort((a, b) => {
      const ao = Math.min(...a.navItems.map((item) => item.order), Number.MAX_SAFE_INTEGER)
      const bo = Math.min(...b.navItems.map((item) => item.order), Number.MAX_SAFE_INTEGER)
      return ao - bo || a.id.localeCompare(b.id)
    })
    this.storage = storage
    this.state = reactive<Record<string, boolean>>(loadState(this.manifests, storage))
    for (const manifest of this.manifests) {
      if (this.state[manifest.id]) this.registerExtensionPoints(manifest)
    }
  }

  get enabledManifests(): ModManifest[] {
    return this.manifests.filter((manifest) => this.state[manifest.id])
  }

  get enabledNavItems(): EnabledNavItem[] {
    return this.enabledManifests
      .flatMap((manifest) => manifest.navItems.map((item) => ({ ...item, modId: manifest.id })))
      .sort((a, b) => a.order - b.order || a.modId.localeCompare(b.modId))
  }

  get enabledRoutes(): RouteRecordRaw[] {
    return this.enabledManifests.flatMap((manifest) =>
      manifest.routes.map((route) => ({
        ...route,
        meta: { ...route.meta, mod: manifest.id },
      })),
    )
  }

  isEnabled(id: ModId): boolean {
    return this.state[id] === true
  }

  getManifest(id: string): ModManifest | undefined {
    return this.manifests.find((manifest) => manifest.id === id)
  }

  async initialize(): Promise<void> {
    for (const manifest of this.enabledManifests) await this.activate(manifest)
  }

  async setEnabled(id: ModId, enabled: boolean): Promise<void> {
    const manifest = this.getManifest(id)
    if (!manifest) throw new Error(`未知模块：${id}`)
    if (this.state[id] === enabled) {
      if (enabled) await this.activate(manifest)
      return
    }
    this.state[id] = enabled
    this.persist()
    if (enabled) {
      this.registerExtensionPoints(manifest)
      await this.activate(manifest)
    } else {
      await this.deactivate(manifest)
      this.capabilities.unregister(id)
      this.slots.remove(id)
    }
  }

  private registerExtensionPoints(manifest: ModManifest): void {
    this.capabilities.register(manifest.id, manifest.providesCapabilities)
    this.slots.contribute(manifest.id, manifest.slotContributions)
  }

  private async activate(manifest: ModManifest): Promise<void> {
    if (this.activated.has(manifest.id)) return
    this.activated.add(manifest.id)
    await manifest.onActivate?.({
      manifest,
      capabilities: this.capabilities,
      slots: this.slots,
    })
  }

  private async deactivate(manifest: ModManifest): Promise<void> {
    if (!this.activated.delete(manifest.id)) return
    await manifest.onDeactivate?.()
  }

  private persist(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ ...this.state }))
    } catch {
      // Keep the in-memory switch usable if local storage is unavailable.
    }
  }
}

export function createModRegistry(manifests: readonly ModManifest[], storage?: Storage): ModRegistry {
  return new ModRegistry(manifests, storage)
}
