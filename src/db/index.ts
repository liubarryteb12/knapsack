import Dexie, { type Table } from 'dexie'
import type { Trip } from '../schema/trip'
import type { DailyDay } from '../mods/mod-daily/schema'
import type { FinanceEntry } from '../mods/mod-finance/schema'

/** IndexedDB 封装：v1 trips，v2 团队表，v3 日常规划表，v4 日常账房表 */
export class KnapsackDB extends Dexie {
  trips!: Table<Trip, string>
  /** v2 起可用：团队聚合根 */
  teamState!: Table<import('../team/schema').TeamState, string>
  teamPublications!: Table<import('../db/teamSchema').TeamPublicationRow, string>
  teamOutbox!: Table<import('../db/teamSchema').TeamOutboxEntry, string>
  teamIdempotency!: Table<import('../db/teamSchema').TeamIdempotencyRecord, string>
  teamLink!: Table<import('../db/teamSchema').TeamLink, string>
  /** v3 起可用：按日期存一条日常规划 */
  dailyDays!: Table<DailyDay, string>
  /** v4 起可用：本地账目 */
  financeEntries!: Table<FinanceEntry, string>

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
  }
}

export const db = new KnapsackDB()
