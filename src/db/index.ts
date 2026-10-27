import Dexie, { type Table } from 'dexie'
import { MOD_MANIFESTS } from '../core/bootMods'
import {
  buildModDbSchema,
  copyLegacyModStores,
  deriveModDbVersion,
} from '../core/sandboxedDb'

/**
 * IndexedDB host.
 *
 * Existing v1-v4 stores stay available during expand-contract. Manifest-declared
 * mod_* stores are created automatically and receive a one-time legacy mirror.
 * New modules use db.table('mod_...') without editing this class.
 */
export class KnapsackDB extends Dexie {
  get trips(): Table<any, string> {
    return this.table('mod_trip_trips')
  }

  get teamState(): Table<any, string> {
    return this.table('mod_team_groups')
  }

  get teamPublications(): Table<any, string> {
    return this.table('mod_team_publications')
  }

  get teamOutbox(): Table<any, string> {
    return this.table('mod_team_outbox')
  }

  get teamIdempotency(): Table<any, string> {
    return this.table('mod_team_idempotency')
  }

  get teamLink(): Table<any, string> {
    return this.table('mod_team_link')
  }

  get teamPackages(): Table<any, string> {
    return this.table('mod_team_packages')
  }

  get dailyDays(): Table<any, string> {
    return this.table('mod_daily_days')
  }

  get financeEntries(): Table<any, string> {
    return this.table('mod_finance_entries')
  }

  constructor(name = 'knapsack', manifests = MOD_MANIFESTS) {
    super(name)
    this.version(1).stores({
      trips: 'id, name, startDate',
    })
    this.version(2).stores({
      trips: 'id, name, startDate',
      teamState: 'teamId',
      teamPublications: 'publicationId, teamId, [teamId+version]',
      teamOutbox: 'operationId, teamId, kind, createdAt',
      teamIdempotency: 'idempotencyKey, teamId',
      teamLink: 'teamId',
    })
    this.version(3).stores({
      trips: 'id, name, startDate',
      teamState: 'teamId',
      teamPublications: 'publicationId, teamId, [teamId+version]',
      teamOutbox: 'operationId, teamId, kind, createdAt',
      teamIdempotency: 'idempotencyKey, teamId',
      teamLink: 'teamId',
      dailyDays: 'date, updatedAt',
    })
    this.version(4).stores({
      trips: 'id, name, startDate',
      teamState: 'teamId',
      teamPublications: 'publicationId, teamId, [teamId+version]',
      teamOutbox: 'operationId, teamId, kind, createdAt',
      teamIdempotency: 'idempotencyKey, teamId',
      teamLink: 'teamId',
      dailyDays: 'date, updatedAt',
      financeEntries: 'id, date, category, &sourceKey, [date+category]',
    })
    this.version(deriveModDbVersion(manifests))
      .stores(buildModDbSchema(manifests))
      .upgrade((tx) => copyLegacyModStores(tx, manifests))
  }
}

export const db = new KnapsackDB()
