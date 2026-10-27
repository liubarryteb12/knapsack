import { defineStore } from 'pinia'
import { db } from '../../../db'
import {
  teamPackageRecordSchema,
  type TeamPackageRecord,
  type TeamPackageStatus,
} from '../schema/team-package.schema'

function sortRecords(records: TeamPackageRecord[]): TeamPackageRecord[] {
  return [...records].sort((left, right) => right.updatedAt - left.updatedAt)
}

export function effectivePending(records: TeamPackageRecord[]): TeamPackageRecord[] {
  const resolvedRevision = new Map<string, number>()
  for (const record of records) {
    if (record.direction !== 'RECEIVED') continue
    if (record.status !== 'ACCEPTED' && record.status !== 'REJECTED') continue
    resolvedRevision.set(
      record.packageId,
      Math.max(resolvedRevision.get(record.packageId) ?? 0, record.package.revision),
    )
  }

  const pending = new Map<string, TeamPackageRecord>()
  for (const record of records) {
    if (record.direction !== 'RECEIVED') continue
    if (record.status !== 'PENDING_REVIEW' && record.status !== 'READY') continue
    if (record.package.revision <= (resolvedRevision.get(record.packageId) ?? 0)) continue
    const current = pending.get(record.packageId)
    if (
      !current ||
      record.package.revision > current.package.revision ||
      (record.package.revision === current.package.revision && record.updatedAt > current.updatedAt)
    ) {
      pending.set(record.packageId, record)
    }
  }
  return sortRecords([...pending.values()])
}

export const useTeamPackageStore = defineStore('team-packages', {
  state: () => ({
    records: [] as TeamPackageRecord[],
    loading: false,
    error: '',
  }),

  getters: {
    pending(state): TeamPackageRecord[] {
      return effectivePending(state.records)
    },
    sentCount(state): number {
      return state.records.filter((record) => record.direction === 'SENT').length
    },
    receivedCount(state): number {
      return state.records.filter((record) => record.direction === 'RECEIVED').length
    },
  },

  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        const rows = await db.teamPackages.toArray()
        const parsed: TeamPackageRecord[] = []
        for (const row of rows) {
          const result = teamPackageRecordSchema.safeParse(row)
          if (result.success) parsed.push(result.data)
          else this.error = '有共享包历史无法解析，已跳过损坏记录'
        }
        this.records = sortRecords(parsed)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        this.loading = false
      }
    },

    async save(record: TeamPackageRecord): Promise<TeamPackageRecord> {
      const [saved] = await this.saveMany([record])
      return saved!
    },

    async saveMany(records: TeamPackageRecord[]): Promise<TeamPackageRecord[]> {
      const parsed = records.map((record) => teamPackageRecordSchema.parse(record))
      const plain = parsed.map((record) =>
        JSON.parse(JSON.stringify(record)) as TeamPackageRecord,
      )
      if (plain.length === 0) return []
      await db.transaction('rw', db.teamPackages, async () => {
        await db.teamPackages.bulkPut(plain)
      })
      const replaced = new Set(plain.map((record) => record.recordId))
      this.records = sortRecords([
        ...parsed,
        ...this.records.filter((row) => !replaced.has(row.recordId)),
      ])
      return parsed
    },

    async setStatus(recordId: string, status: TeamPackageStatus): Promise<void> {
      const current = this.records.find((record) => record.recordId === recordId)
      if (!current) throw new Error('共享包记录不存在')
      await this.save({
        ...current,
        status,
        updatedAt: Date.now(),
      })
    },
  },
})
