import type { ModManifest } from './modRegistry'
import { validateModManifests } from './modRegistry'

export interface DiscoveredModModule {
  default?: ModManifest
  manifest?: ModManifest
}

export type DiscoveredModGlob = Record<string, DiscoveredModModule | ModManifest>

export function discoverMods(modules: DiscoveredModGlob): ModManifest[] {
  const manifests: ModManifest[] = []
  for (const [path, value] of Object.entries(modules)) {
    const manifest = 'id' in value ? value : (value.default ?? value.manifest)
    if (!manifest) throw new Error(`模块清单 ${path} 没有默认 ModManifest 导出`)
    manifests.push(manifest)
  }
  return validateModManifests(manifests)
}
