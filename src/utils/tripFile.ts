import { parseTripJson, tripSchema, type Trip } from '../schema/trip'

/** 下载 JSON 为 .trip 文件 */
export function exportTripFile(trip: Trip): void {
  const text = JSON.stringify(trip, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${trip.name || '旅行'}.trip`
  a.click()
  URL.revokeObjectURL(url)
}

export type ImportErrorKind = 'not_json' | 'bad_format' | 'invalid_data' | 'unknown'

export class TripImportError extends Error {
  kind: ImportErrorKind
  constructor(kind: ImportErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** 导入 .trip：先查 format 字段，再过 Zod。给人话错误，绝不静默写入 */
export function readTripFile(text: string): Trip {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new TripImportError('not_json', '文件不是有效的 JSON 格式，无法导入')
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TripImportError('bad_format', '文件内容结构不对，这不是一个旅行文件')
  }

  const format = (data as Record<string, unknown>).format
  if (format !== 'trip.v1') {
    throw new TripImportError(
      'bad_format',
      `不支持的文件格式：${String(format ?? '未知')}。本应用只支持 trip.v1`,
    )
  }

  const result = tripSchema.safeParse(data)
  if (!result.success) {
    const firstError = result.error.issues[0]
    const path = firstError?.path.join('.') ?? ''
    throw new TripImportError(
      'invalid_data',
      `文件数据校验失败${path ? `（${path}）` : ''}：${firstError?.message ?? '数据不完整'}`,
    )
  }
  return result.data
}

/** 从 File 对象读取文本 */
export function readTripFileInput(file: File): Promise<string> {
  return file.text()
}

export { parseTripJson }
