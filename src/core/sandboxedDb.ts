import type { Transaction } from 'dexie'
import type { ModDbIndex, ModDbStore, ModManifest } from './modRegistry'

export const LEGACY_HOST_SCHEMA: Record<string, string> = {
  trips: 'id, name, startDate',
  teamState: 'teamId',
  teamPublications: 'publicationId, teamId, [teamId+version]',
  teamOutbox: 'operationId, teamId, kind, createdAt',
  teamIdempotency: 'idempotencyKey, teamId',
  teamLink: 'teamId',
  dailyDays: 'date, updatedAt',
  financeEntries: 'id, date, category, &sourceKey, [date+category]',
  mod_trip_team_state: 'teamId',
  mod_trip_team_publications: 'publicationId, teamId, [teamId+version]',
  mod_trip_team_outbox: 'operationId, teamId, kind, createdAt',
  mod_trip_team_idempotency: 'idempotencyKey, teamId',
  mod_trip_team_link: 'teamId',
}

function keyPathSpec(keyPath: string | string[]): string {
  return Array.isArray(keyPath) ? `[${keyPath.join('+')}]` : keyPath
}

function indexSpec(index: ModDbIndex): string {
  const prefix = `${index.unique ? '&' : ''}${index.multi ? '*' : ''}`
  return prefix + keyPathSpec(index.keyPath)
}

export function serializeDbStore(store: ModDbStore): string {
  return [
    keyPathSpec(store.keyPath),
    ...(store.indexes ?? []).map(indexSpec),
  ].join(', ')
}

export function buildModDbSchema(manifests: readonly ModManifest[]): Record<string, string> {
  const schema: Record<string, string> = { ...LEGACY_HOST_SCHEMA }
  for (const manifest of manifests) {
    for (const store of manifest.dbStores) schema[store.name] = serializeDbStore(store)
  }
  return schema
}

/**
 * Dexie versions must increase when any manifest changes its stores. The module
 * owns its schemaRevision, so adding a cartridge or changing one of its stores
 * never requires editing the host DB file.
 */
export function deriveModDbVersion(manifests: readonly ModManifest[]): number {
  const revisions = manifests.reduce((sum, manifest) => sum + manifest.schemaRevision, 0)
  return 1000 + manifests.length * 100 + revisions
}

/** Copy legacy rows into prefixed mirrors inside the same upgrade transaction. */
export async function copyLegacyModStores(
  tx: Transaction,
  manifests: readonly ModManifest[],
): Promise<void> {
  const names = new Set(tx.db.tables.map((table) => table.name))
  for (const manifest of manifests) {
    for (const store of manifest.dbStores) {
      const legacyNames = store.legacyNames ?? (store.legacyName ? [store.legacyName] : [])
      if (legacyNames.length === 0 || !names.has(store.name)) continue
      const target = tx.table(store.name)
      if ((await target.count()) > 0) continue
      for (const legacyName of legacyNames) {
        if (!names.has(legacyName)) continue
        const rows = await tx.table(legacyName).toArray()
        if (rows.length > 0) await target.bulkPut(rows)
      }
    }
  }
}
