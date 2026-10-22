import Dexie, { type Table } from 'dexie'
import type { Trip } from '../schema/trip'

/** IndexedDB 封装：v1 单表 trips，v2 增加团队表（见 teamSchema.ts） */
export class KnapsackDB extends Dexie {
  trips!: Table<Trip, string>
  /** v2 起可用：团队聚合根 */
  teamState!: Table<import('../team/schema').TeamState, string>
  teamPublications!: Table<import('../db/teamSchema').TeamPublicationRow, string>
  teamOutbox!: Table<import('../db/teamSchema').TeamOutboxEntry, string>
  teamIdempotency!: Table<import('../db/teamSchema').TeamIdempotencyRecord, string>
  teamLink!: Table<import('../db/teamSchema').TeamLink, string>

  constructor() {
    super('knapsack')
    this.version(1).stores({
      trips: 'id, name, startDate',
    })
    this.version(2).stores({
      // trips 保持原样；新增团队表，不影响旧数据
      trips: 'id, name, startDate',
      teamState: 'teamId',
      teamPublications: 'publicationId, teamId, [teamId+version]',
      teamOutbox: 'operationId, teamId, kind, createdAt',
      teamIdempotency: 'idempotencyKey, teamId',
      teamLink: 'teamId',
    })
  }
}

export const db = new KnapsackDB()
