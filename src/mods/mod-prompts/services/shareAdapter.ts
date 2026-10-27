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
import {
  promptItemSchema,
  promptSnippetSchema,
  type PromptItem,
  type PromptSnippet,
} from '../schema'

export const PROMPT_SHARE_FORMAT = 'prompt-share.v1'
export const PROMPT_SHARE_PACKAGE_TYPE = 'PROMPT_COLLECTION'

const DEVICE_ID_STORAGE_KEY = 'knapsack.share.device-id.v1'
const NICKNAME_STORAGE_KEY = 'knapsack.share.nickname.v1'

export const promptSharePayloadSchema = z.object({
  format: z.literal(PROMPT_SHARE_FORMAT),
  items: z.array(promptItemSchema).min(1),
  snippets: z.array(promptSnippetSchema).default([]),
})

export type PromptSharePayload = z.infer<typeof promptSharePayloadSchema>

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
  if (request?.sourceModId && request.sourceModId !== 'mod-prompts') return false
  if (request?.packageType && request.packageType !== PROMPT_SHARE_PACKAGE_TYPE) return false
  return true
}

async function loadItems(itemIds?: string[]): Promise<PromptItem[]> {
  const table = db.table<PromptItem, string>('mod_prompts_items')
  if (itemIds === undefined) {
    return (await table.toArray()).map((item) => promptItemSchema.parse(item))
  }
  const ids = [...new Set(itemIds)]
  if (ids.length === 0) return []
  const rows = await table.bulkGet(ids)
  if (rows.some((item) => !item)) throw new Error('存在未找到的提示词，未生成不完整共享包')
  return rows.map((item) => promptItemSchema.parse(item))
}

async function loadReferencedSnippets(items: PromptItem[]): Promise<PromptSnippet[]> {
  const referencedIds = new Set(
    items.flatMap((item) =>
      item.modality === 'IMAGE_GEN'
        ? item.payload.activeSnippets.map((snippet) => snippet.snippetId)
        : [],
    ),
  )
  if (referencedIds.size === 0) return []
  const rows = await db.table<PromptSnippet, string>('mod_prompts_snippets').toArray()
  return rows
    .filter((snippet) => referencedIds.has(snippet.id))
    .map((snippet) => promptSnippetSchema.parse(snippet))
}

export async function exportShareablePackages(
  request?: ShareablePackageExportRequest,
): Promise<ShareablePackage[]> {
  if (!supportsRequest(request)) return []
  const items = await loadItems(request?.itemIds)
  if (items.length === 0) return []
  const snippets = await loadReferencedSnippets(items)
  const payload: PromptSharePayload = {
    format: PROMPT_SHARE_FORMAT,
    items,
    snippets,
  }
  const lineage = {
    sourceModId: 'mod-prompts' as const,
    packageType: PROMPT_SHARE_PACKAGE_TYPE,
    itemKeys: items.map((item) => item.id),
  }
  const identity = await nextShareIdentity(lineage, 'prompts')
  const signed = await signShareablePackage({
    packageId: identity.packageId,
    createdAt: new Date().toISOString(),
    sourceModId: 'mod-prompts',
    packageType: PROMPT_SHARE_PACKAGE_TYPE,
    title: items.length === 1 ? items[0]!.title : `${items.length} 条提示词合辑`,
    releaseNote: `完整提示词快照，共 ${items.length} 条`,
    permissionMode: request?.permissionMode ?? 'COLLABORATIVE',
    revision: identity.revision,
    author: localAuthor(),
    payload,
  })
  await rememberPackageLineage(signed, items.map((item) => item.id))
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
    if (sharePackage.sourceModId !== 'mod-prompts') {
      return importResult(packageId, false, '共享包不属于提示词模块')
    }
    if (sharePackage.packageType !== PROMPT_SHARE_PACKAGE_TYPE) {
      return importResult(packageId, false, '不支持的提示词共享包类型')
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

    const payload = promptSharePayloadSchema.parse(sharePackage.payload)
    const itemIds = new Set(payload.items.map((item) => item.id))
    const snippetIds = new Set(payload.snippets.map((snippet) => snippet.id))
    if (itemIds.size !== payload.items.length) {
      return importResult(packageId, false, '提示词 ID 重复')
    }
    if (snippetIds.size !== payload.snippets.length) {
      return importResult(packageId, false, '词块 ID 重复')
    }

    const itemsTable = db.table<PromptItem, string>('mod_prompts_items')
    const snippetsTable = db.table<PromptSnippet, string>('mod_prompts_snippets')
    const existingSnippetIds = new Set(
      (await snippetsTable.toArray()).map((snippet) => snippet.id),
    )
    const referencedSnippetIds = payload.items.flatMap((item) =>
      item.modality === 'IMAGE_GEN'
        ? item.payload.activeSnippets.map((snippet) => snippet.snippetId)
        : [],
    )
    const missingSnippet = referencedSnippetIds.find(
      (snippetId) =>
        !snippetIds.has(snippetId) && !existingSnippetIds.has(snippetId),
    )
    if (missingSnippet) {
      return importResult(packageId, false, `提示词引用了缺失词块：${missingSnippet}`)
    }

    const mode = request.mode ?? 'MERGE'
    await prepareImportedPackage(
      sharePackage,
      payload.items.map((item) => item.id),
      mode,
      async (itemId) => (await itemsTable.get(itemId)) !== undefined,
    )
    const snippets =
      mode === 'LOCAL_COPY'
        ? payload.snippets.map((snippet) =>
            promptSnippetSchema.parse({
              ...JSON.parse(JSON.stringify(snippet)),
              id: nanoid(10),
              usageCount: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }),
          )
        : payload.snippets
    const snippetMap = new Map(
      payload.snippets.map((snippet, index) => [snippet.id, snippets[index]!.id]),
    )
    const items =
      mode === 'LOCAL_COPY'
        ? payload.items.map((item) => {
            const copy = JSON.parse(JSON.stringify(item)) as PromptItem
            const withoutCover = { ...copy, coverMediaId: undefined }
            if (withoutCover.modality === 'IMAGE_GEN') {
              withoutCover.payload.activeSnippets = withoutCover.payload.activeSnippets.map(
                (snippet) => ({
                  ...snippet,
                  snippetId: snippetMap.get(snippet.snippetId) ?? snippet.snippetId,
                }),
              )
            }
            return promptItemSchema.parse({
              ...withoutCover,
              id: nanoid(12),
              isFavorite: false,
              usageCount: 0,
              version: 1,
              history: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
          })
        : payload.items.map((item) => {
            const copy = { ...JSON.parse(JSON.stringify(item)) as PromptItem }
            delete copy.coverMediaId
            return promptItemSchema.parse(copy)
          })

    await db.transaction('rw', itemsTable, snippetsTable, async () => {
      if (snippets.length > 0) await snippetsTable.bulkPut(snippets)
      await itemsTable.bulkPut(items)
    })
    return importResult(
      packageId,
      true,
      mode === 'LOCAL_COPY'
        ? `提示词只读包已作为 ${items.length} 条新副本保存`
        : '提示词共享包已写入本机沙箱',
    )
  } catch (error) {
    return importResult(packageId, false, errorMessage(error))
  }
}
