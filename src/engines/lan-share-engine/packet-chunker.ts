/**
 * QR packet transport for generic JSON values.
 *
 * The compressed payload is chunked as raw gzip bytes; each QR frame carries
 * an independently verifiable base64url copy of one chunk.
 */
import { b64urlToBytes, bytesToB64url } from './lanSessionProtocol'
import { sha256Hex } from './digest-signer'

export const MAX_SINGLE_QR_BYTES = 800
export const DEFAULT_CHUNK_SIZE = 500

const FRAME_PATTERN = /^KNAP\|([^|]{8})\|(\d+)\/(\d+)\|(\d+)\|([A-Za-z0-9_-]+)$/
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8}$/

export interface QrPacketFrame {
  text: string
  packageId: string
  seq: number
  total: number
  crc32: number
  payloadB64: string
  bytes: Uint8Array<ArrayBuffer>
}

export interface PacketChunkResult {
  packageId: string
  mode: 'single' | 'multi'
  digest: string
  frames: string[]
  frameDetails: QrPacketFrame[]
}

export interface PacketProgress {
  received: number
  total: number
  percent: number
}

export interface PacketChunkReceipt {
  seq: number
  total: number
  packageId: string
  accepted: boolean
  progress: PacketProgress
}

export interface CreatePacketFramesOptions {
  packageId: string
  chunkSize?: number
  singleQrLimit?: number
  /** Reuse an existing package digest instead of deriving a generic JSON digest. */
  digest?: string
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

export function crc32(input: string | Uint8Array): number {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let value = 0xffffffff
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

async function gzip(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream !== 'function') {
    throw new Error('当前运行时不支持 CompressionStream，无法压缩 QR 包')
  }
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前运行时不支持 DecompressionStream，无法解压 QR 包')
  }
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function assertPackageId(options: CreatePacketFramesOptions): string {
  const packageId = options.packageId.slice(0, 8)
  if (!PACKAGE_ID_PATTERN.test(packageId)) {
    throw new TypeError('packageId 前 8 位必须由字母、数字、下划线或连字符组成')
  }
  return packageId
}

function makeFrame(
  packageId: string,
  seq: number,
  total: number,
  bytes: Uint8Array<ArrayBuffer>,
): QrPacketFrame {
  const payloadB64 = bytesToB64url(bytes)
  return {
    text: `KNAP|${packageId}|${seq}/${total}|${crc32(payloadB64)}|${payloadB64}`,
    packageId,
    seq,
    total,
    crc32: crc32(payloadB64),
    payloadB64,
    bytes: new Uint8Array(bytes),
  }
}

function isQrPacketFrame(value: unknown): value is QrPacketFrame {
  return typeof value === 'object' && value !== null && [
    'text',
    'packageId',
    'seq',
    'total',
    'crc32',
    'payloadB64',
    'bytes',
  ].every((key) => key in value)
}

function validateFrameBytes(frame: QrPacketFrame): Uint8Array<ArrayBuffer> {
  const decoded = b64urlToBytes(frame.payloadB64)
  if (!bytesEqual(decoded, frame.bytes)) {
    throw new Error(`帧 ${frame.seq}/${frame.total} 的 base64 载荷与字节不一致`)
  }
  if (crc32(frame.payloadB64) !== frame.crc32) {
    throw new Error(`帧 ${frame.seq}/${frame.total} CRC32 校验失败`)
  }
  return new Uint8Array(decoded)
}

export function parsePacketFrame(input: string): QrPacketFrame {
  const match = FRAME_PATTERN.exec(input.trim())
  if (!match) {
    throw new Error('不是合法的 KNAP QR 分片帧')
  }
  const [, packageId, seqText, totalText, crcText, payloadB64] = match
  const seq = Number(seqText)
  const total = Number(totalText)
  const crc = Number(crcText)
  if (!Number.isInteger(seq) || !Number.isInteger(total) || seq < 1 || total < 1 || seq > total) {
    throw new Error(`QR 分片序号越界：${seq}/${total}`)
  }
  if (!Number.isInteger(crc) || crc < 0 || crc > 0xffffffff) {
    throw new Error(`QR 分片 CRC32 不合法：${crcText}`)
  }
  const bytes = b64urlToBytes(payloadB64 ?? '')
  const actualCrc = crc32(payloadB64 ?? '')
  if (actualCrc !== crc) {
    throw new Error(`帧 ${seq}/${total} CRC32 校验失败：期望 ${crc}，实际 ${actualCrc}`)
  }
  return {
    text: input.trim(),
    packageId: packageId ?? '',
    seq,
    total,
    crc32: crc,
    payloadB64: payloadB64 ?? '',
    bytes,
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

export async function createPacketFrames<T>(
  value: T,
  options: CreatePacketFramesOptions,
): Promise<PacketChunkResult> {
  const packageId = assertPackageId(options)
  const singleQrLimit = options.singleQrLimit ?? MAX_SINGLE_QR_BYTES
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  if (!Number.isInteger(singleQrLimit) || singleQrLimit < 1) {
    throw new TypeError('singleQrLimit 必须是正整数')
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new TypeError('chunkSize 必须是正整数')
  }
  if (chunkSize > singleQrLimit) {
    throw new TypeError('chunkSize 不能大于单帧二维码容量上限')
  }
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('只有 JSON 可序列化值才能生成 QR 分片')
  }
  const digest = options.digest ?? await sha256Hex(serialized)
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new TypeError('digest 必须是 64 位小写十六进制 SHA-256')
  }
  const compressed = await gzip(new TextEncoder().encode(serialized))
  const frameDetails: QrPacketFrame[] = []
  if (compressed.length <= singleQrLimit) {
    frameDetails.push(makeFrame(packageId, 1, 1, compressed))
  } else {
    for (let offset = 0; offset < compressed.length; offset += chunkSize) {
      frameDetails.push(makeFrame(
        packageId,
        frameDetails.length + 1,
        Math.ceil(compressed.length / chunkSize),
        compressed.slice(offset, offset + chunkSize),
      ))
    }
  }
  return {
    packageId,
    mode: frameDetails.length === 1 ? 'single' : 'multi',
    digest,
    frames: frameDetails.map((frame) => frame.text),
    frameDetails,
  }
}

export class PacketReceiver {
  private readonly received = new Map<number, QrPacketFrame>()
  private bits: Uint8Array
  private packageId?: string
  private total?: number

  constructor(options: { total?: number } = {}) {
    const total = options.total
    if (total !== undefined && (!Number.isInteger(total) || total < 1)) {
      throw new TypeError('total 必须是正整数')
    }
    this.total = total
    this.bits = new Uint8Array(total ? Math.ceil(total / 8) : 0)
  }

  receiveChunk(input: string | QrPacketFrame): PacketChunkReceipt {
    const frame = typeof input === 'string'
      ? parsePacketFrame(input)
      : this.validateFrame(input)
    this.packageId ??= frame.packageId
    this.total ??= frame.total
    if (this.packageId !== frame.packageId) {
      throw new Error(`QR 分片 packageId 不一致：${this.packageId} / ${frame.packageId}`)
    }
    if (this.total !== frame.total) {
      throw new Error(`QR 分片总帧数不一致：${this.total} / ${frame.total}`)
    }
    const seq = frame.seq
    const existing = this.received.get(seq)
    if (existing && !bytesEqual(existing.bytes, frame.bytes)) {
      throw new Error(`QR 分片 ${seq}/${frame.total} 出现冲突内容`)
    }
    this.received.set(seq, frame)
    this.mark(seq - 1)
    return {
      seq,
      total: frame.total,
      packageId: frame.packageId,
      accepted: !existing,
      progress: this.progress,
    }
  }

  get progress(): PacketProgress {
    const total = this.total ?? 0
    const received = this.received.size
    return {
      received,
      total,
      percent: total === 0 ? 0 : Math.round((received / total) * 100),
    }
  }

  get bitset(): Readonly<Uint8Array> {
    return this.bits
  }

  get isComplete(): boolean {
    return this.total !== undefined && this.received.size === this.total
  }

  async complete<T>(): Promise<T> {
    if (this.total === undefined || !this.isComplete) {
      const missing = this.missingSequences().join(', ')
      throw new Error(`QR 分片未齐，缺少：${missing || '未知总帧数'}`)
    }
    const totalBytes = [...this.received.values()].reduce((size, frame) => size + frame.bytes.length, 0)
    const compressed = new Uint8Array(totalBytes)
    let offset = 0
    for (let seq = 1; seq <= this.total; seq++) {
      const bytes = this.received.get(seq)!.bytes
      compressed.set(bytes, offset)
      offset += bytes.length
    }
    const plain = await gunzip(compressed)
    try {
      return JSON.parse(new TextDecoder().decode(plain)) as T
    } catch {
      throw new Error('QR 分片解压后不是合法 JSON')
    }
  }

  private validateFrame(frame: QrPacketFrame): QrPacketFrame {
    if (!isQrPacketFrame(frame) || !PACKAGE_ID_PATTERN.test(frame.packageId)) {
      throw new TypeError('QR 分片帧结构不合法')
    }
    if (!Number.isInteger(frame.seq) || !Number.isInteger(frame.total) ||
      frame.seq < 1 || frame.total < 1 || frame.seq > frame.total) {
      throw new RangeError(`QR 分片序号越界：${frame.seq}/${frame.total}`)
    }
    validateFrameBytes(frame)
    return frame
  }

  private mark(bit: number): void {
    if (this.total === undefined) return
    if (this.bits.length === 0) {
      this.bits = new Uint8Array(Math.ceil(this.total / 8))
    }
    this.bits[bit >>> 3]! |= 1 << (bit & 7)
  }

  private missingSequences(): number[] {
    if (this.total === undefined) return []
    const missing: number[] = []
    for (let seq = 1; seq <= this.total; seq++) {
      if (!this.received.has(seq)) missing.push(seq)
    }
    return missing
  }
}
