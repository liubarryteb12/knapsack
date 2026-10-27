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
import { addDays } from '../../../utils/date'
import {
  dailyDateSchema,
  dailyDaySchema,
  type DailyDay,
} from '../schema'

export const DAILY_SHARE_FORMAT = 'daily-share.v1'
export const DAILY_SHARE_PACKAGE_TYPE = 'DAILY_TODO'

const DEVICE_ID_STORAGE_KEY = 'knapsack.share.device-id.v1'
const NICKNAME_STORAGE_KEY = 'knapsack.share.nickname.v1'

export const dailySharePayloadSchema = z.object({
  format: z.literal(DAILY_SHARE_FORMAT),
  days: z.array(dailyDaySchema).min(1),
})

export type DailySharePayload = z.infer<typeof dailySharePayloadSchema>

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
  if (request?.sourceModId && request.sourceModId !== 'mod-daily') return false
  if (request?.packageType && request.packageType !== DAILY_SHARE_PACKAGE_TYPE) return false
  return true
}

async function loadDays(itemIds?: string[]): Promise<DailyDay[]> {
  if (itemIds === undefined) {
    const rows = await db.dailyDays.toArray()
    return rows.map((day) => dailyDaySchema.parse(day))
  }
  const dates = [...new Set(itemIds)].map((date) => dailyDateSchema.parse(date))
  if (dates.length === 0) return []
  const rows = await db.dailyDays.bulkGet(dates)
  if (rows.some((day) => !day)) throw new Error('存在未找到的日期，未生成不完整共享包')
  return rows.map((day) => dailyDaySchema.parse(day))
}

export async function exportShareablePackages(
  request?: ShareablePackageExportRequest,
): Promise<ShareablePackage[]> {
  if (!supportsRequest(request)) return []
  const days = await loadDays(request?.itemIds)
  if (days.length === 0) return []
  const payload: DailySharePayload = {
    format: DAILY_SHARE_FORMAT,
    days,
  }
  const lineage = {
    sourceModId: 'mod-daily' as const,
    packageType: DAILY_SHARE_PACKAGE_TYPE,
    itemKeys: days.map((day) => day.date),
  }
  const identity = await nextShareIdentity(lineage, 'daily')
  const signed = await signShareablePackage({
    packageId: identity.packageId,
    createdAt: new Date().toISOString(),
    sourceModId: 'mod-daily',
    packageType: DAILY_SHARE_PACKAGE_TYPE,
    title: days.length === 1 ? `每日计划 ${days[0]!.date}` : `${days.length} 天计划`,
    releaseNote: '任务、备忘与复盘快照',
    permissionMode: request?.permissionMode ?? 'COLLABORATIVE',
    revision: identity.revision,
    author: localAuthor(),
    payload,
  })
  await rememberPackageLineage(signed, days.map((day) => day.date))
  return [signed]
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
    if (sharePackage.sourceModId !== 'mod-daily') {
      return importResult(packageId, false, '共享包不属于每日计划模块')
    }
    if (sharePackage.packageType !== DAILY_SHARE_PACKAGE_TYPE) {
      return importResult(packageId, false, '不支持的每日计划共享包类型')
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

    const payload = dailySharePayloadSchema.parse(sharePackage.payload)
    const dates = new Set(payload.days.map((day) => day.date))
    if (dates.size !== payload.days.length) {
      return importResult(packageId, false, '每日计划日期重复')
    }
    const mode = request.mode ?? 'MERGE'
    await prepareImportedPackage(
      sharePackage,
      payload.days.map((day) => day.date),
      mode,
      async (date) => (await db.dailyDays.get(date)) !== undefined,
    )
    if (mode === 'LOCAL_COPY') {
      const localDates = (await db.dailyDays.toArray()).map((day) => day.date)
      const ordered = [...payload.days].sort((left, right) => left.date.localeCompare(right.date))
      const latestDate = [...localDates, ...ordered.map((day) => day.date)].sort().at(-1)
      if (!latestDate) throw new Error('没有可用于生成只读副本的日期')
      const now = Date.now()
      const copies = ordered.map((day, index) =>
        dailyDaySchema.parse({
          ...JSON.parse(JSON.stringify(day)),
          date: addDays(latestDate, index + 1),
          tasks: day.tasks.map((task) => ({
            ...JSON.parse(JSON.stringify(task)),
            id: nanoid(10),
            originTaskId: null,
            rolloverCount: 0,
            createdAt: now,
            updatedAt: now,
          })),
          createdAt: now,
          updatedAt: now,
        }),
      )
      await db.dailyDays.bulkPut(copies)
      return importResult(packageId, true, `每日计划只读包已写入 ${copies.length} 个新日期副本`)
    }
    await db.dailyDays.bulkPut(payload.days)
    return importResult(packageId, true, '每日计划共享包已写入本机沙箱')
  } catch (error) {
    return importResult(packageId, false, errorMessage(error))
  }
}
