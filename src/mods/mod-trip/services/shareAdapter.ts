import { nanoid } from 'nanoid'
import { z } from 'zod'
import { db } from '../../../db'
import {
  parseShareablePackage,
  type ShareablePackage,
  type ShareablePackageAuthor,
  type ShareablePackageExportRequest,
  type ShareablePackageImportRequest,
  type ShareablePackageImportResult,
} from '../../../core/types/shareable-package.schema'
import {
  signShareablePackage,
  verifyShareablePackage,
} from '../../../engines/lan-share-engine/digest-signer'
import {
  nextShareIdentity,
  prepareImportedPackage,
  rememberPackageLineage,
} from '../../../engines/lan-share-engine/share-lineage'
import { regenerateAllIds } from '../../../utils/regenerateIds'
import { settleExpenses } from '../settle'
import { tripSchema, type Trip } from '../schema'

export const TRIP_SHARE_FORMAT = 'trip-share.v1'
export const TRIP_SHARE_PACKAGE_TYPE = 'TRIP_ITINERARY'

const DEVICE_ID_STORAGE_KEY = 'knapsack.share.device-id.v1'
const NICKNAME_STORAGE_KEY = 'knapsack.share.nickname.v1'

const tripShareSettlementSchema = z.object({
  tripId: z.string().min(1),
  balances: z.array(
    z.object({
      memberId: z.string().min(1),
      netFen: z.number().int(),
    }),
  ),
  debts: z.array(
    z.object({
      fromId: z.string().min(1),
      toId: z.string().min(1),
      amountFen: z.number().int().min(0),
    }),
  ),
  totalExpenseFen: z.number().int().min(0),
})

export const tripSharePayloadSchema = z.object({
  format: z.literal(TRIP_SHARE_FORMAT),
  trip: tripSchema,
  settlement: tripShareSettlementSchema,
})

export type TripSharePayload = z.infer<typeof tripSharePayloadSchema>

function localAuthor(): ShareablePackageAuthor {
  if (typeof localStorage === 'undefined') {
    throw new Error('本机身份存储不可用，无法导出共享包')
  }
  let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY)?.trim()
  if (!deviceId) {
    deviceId = `device-${nanoid(20)}`
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId)
  }
  let nickname = localStorage.getItem(NICKNAME_STORAGE_KEY)?.trim()
  if (!nickname) {
    nickname = '本机用户'
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname)
  }
  return { deviceId, nickname, role: 'HOST' }
}

function supportsRequest(request?: ShareablePackageExportRequest): boolean {
  if (request?.sourceModId && request.sourceModId !== 'mod-trip') return false
  if (request?.packageType && request.packageType !== TRIP_SHARE_PACKAGE_TYPE) return false
  return true
}

async function loadTrips(itemIds?: string[]): Promise<Trip[]> {
  if (itemIds === undefined) {
    return (await db.trips.toArray()).map((trip) => tripSchema.parse(trip))
  }
  const ids = [...new Set(itemIds)]
  if (ids.length === 0) return []
  const rows = await db.trips.bulkGet(ids)
  if (rows.some((trip) => !trip)) throw new Error('存在未找到的行程，未生成不完整共享包')
  return rows.map((trip) => tripSchema.parse(trip))
}

export async function exportShareablePackages(
  request?: ShareablePackageExportRequest,
): Promise<ShareablePackage[]> {
  if (!supportsRequest(request)) return []
  const trips = await loadTrips(request?.itemIds)
  const author = localAuthor()
  return Promise.all(
    trips.map(async (trip) => {
      const lineage = {
        sourceModId: 'mod-trip' as const,
        packageType: TRIP_SHARE_PACKAGE_TYPE,
        itemKeys: [trip.id],
      }
      const identity = await nextShareIdentity(lineage, 'trip')
      const payload: TripSharePayload = {
        format: TRIP_SHARE_FORMAT,
        trip,
        settlement: {
          tripId: trip.id,
          ...settleExpenses(trip),
        },
      }
      const signed = await signShareablePackage({
        packageId: identity.packageId,
        createdAt: new Date().toISOString(),
        sourceModId: 'mod-trip',
        packageType: TRIP_SHARE_PACKAGE_TYPE,
        title: trip.name.trim() || '未命名行程',
        releaseNote: `行程与分摊快照，共 ${trip.expenses.length} 笔花费`,
        permissionMode: request?.permissionMode ?? 'COLLABORATIVE',
        revision: identity.revision,
        author,
        payload,
      })
      await rememberPackageLineage(signed, [trip.id])
      return signed
    }),
  )
}

function importResult(
  packageId: string,
  accepted: boolean,
  message: string,
): ShareablePackageImportResult {
  return { packageId, accepted, message }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function importShareablePackage(
  request: ShareablePackageImportRequest,
): Promise<ShareablePackageImportResult> {
  const packageId =
    typeof request.package?.packageId === 'string' ? request.package.packageId : ''
  if (!request.approvedByHost) {
    return importResult(packageId, false, '共享包尚未获得团长批准')
  }
  try {
    const sharePackage = parseShareablePackage(request.package)
    if (sharePackage.sourceModId !== 'mod-trip') {
      return importResult(packageId, false, '共享包不属于旅行模块')
    }
    if (sharePackage.packageType !== TRIP_SHARE_PACKAGE_TYPE) {
      return importResult(packageId, false, '不支持的旅行共享包类型')
    }
    if (
      sharePackage.permissionMode === 'READ_ONLY' &&
      request.mode !== 'LOCAL_COPY'
    ) {
      return importResult(packageId, false, '只读共享包不能导入本机沙箱')
    }
    if (!(await verifyShareablePackage(sharePackage))) {
      return importResult(packageId, false, '共享包摘要校验失败')
    }

    const payload = tripSharePayloadSchema.parse(sharePackage.payload)
    if (payload.settlement.tripId !== payload.trip.id) {
      return importResult(packageId, false, '分摊明细与行程 ID 不一致')
    }
    const expectedSettlement = settleExpenses(payload.trip)
    if (JSON.stringify(payload.settlement) !== JSON.stringify({
      tripId: payload.trip.id,
      ...expectedSettlement,
    })) {
      return importResult(packageId, false, '分摊明细与行程内容不一致')
    }

    const mode = request.mode ?? 'MERGE'
    await prepareImportedPackage(
      sharePackage,
      [payload.trip.id],
      mode,
      async (tripId) => (await db.trips.get(tripId)) !== undefined,
    )
    if (mode === 'LOCAL_COPY') {
      const copy = JSON.parse(JSON.stringify(payload.trip)) as Trip
      copy.name = `${copy.name}（共享副本）`
      regenerateAllIds(copy)
      await db.trips.put(tripSchema.parse(copy))
      return importResult(packageId, true, '旅行只读包已作为新行程副本保存')
    }
    await db.trips.put(payload.trip)
    return importResult(packageId, true, '旅行共享包已写入本机沙箱')
  } catch (error) {
    return importResult(packageId, false, errorMessage(error))
  }
}
