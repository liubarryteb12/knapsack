import Dexie, { type Table } from 'dexie'
import type { Trip } from '../schema/trip'

/** IndexedDB 封装：单表 trips，主键 id */
export class KnapsackDB extends Dexie {
  trips!: Table<Trip, string>

  constructor() {
    super('knapsack')
    this.version(1).stores({
      trips: 'id, name, startDate',
    })
  }
}

export const db = new KnapsackDB()
