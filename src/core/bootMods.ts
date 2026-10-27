import { createModRegistry, type ModId } from './modRegistry'
import { discoverMods, type DiscoveredModGlob } from './modDiscovery'
import { STATIC_MOD_MANIFESTS } from '../mods/manifest-index'

let discovered: DiscoveredModGlob
if (typeof import.meta.glob === 'function') {
  discovered = import.meta.glob('../mods/*/manifest.ts', {
    eager: true,
  }) as DiscoveredModGlob
} else {
  discovered = Object.fromEntries(
    STATIC_MOD_MANIFESTS.map((manifest, index) => [`static-${index}`, manifest]),
  )
}

export const modRegistry = createModRegistry(
  discoverMods(discovered),
  typeof localStorage === 'undefined' ? undefined : localStorage,
)

export const MOD_MANIFESTS = modRegistry.manifests
export const modState = modRegistry.state

export function setModEnabled(id: ModId, enabled: boolean): Promise<void> {
  return modRegistry.setEnabled(id, enabled)
}

export function isModEnabled(id: ModId): boolean {
  return modRegistry.isEnabled(id)
}

export function enabledMods() {
  return modRegistry.enabledManifests
}
