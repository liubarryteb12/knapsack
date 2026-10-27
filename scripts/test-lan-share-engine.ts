/**
 * LanShareEngine packet chunker acceptance tests.
 *
 * Run:
 * node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-lan-share-engine.ts
 */
import {
  crc32,
  createPacketFrames,
  PacketReceiver,
  parsePacketFrame,
} from '../src/engines/lan-share-engine/packet-chunker'
import { sha256Hex } from '../src/engines/lan-share-engine/digest-signer'

let failed = 0

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function expectThrow(name: string, action: () => unknown): Promise<void> {
  try {
    await action()
    check(`${name} (unexpected success)`, false)
  } catch (error) {
    check(`${name} -> ${error instanceof Error ? error.message : String(error)}`, true)
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

async function receiveAll(
  receiver: PacketReceiver,
  texts: readonly string[],
): Promise<void> {
  for (const text of texts) {
    receiver.receiveChunk(text)
  }
}

async function main(): Promise<void> {
  check('crc32 has the canonical test vector', crc32('123456789') === 0xcbf43926)

  const singleValue = { title: '短包', prompt: 'a'.repeat(300) }
  const single = await createPacketFrames(singleValue, { packageId: 'single01' })
  check('small gzip JSON becomes one frame', single.mode === 'single' && single.frames.length === 1)
  const singleFrame = single.frames[0] ?? ''
  check('single frame follows the fixed packet header', singleFrame.startsWith('KNAP|single01|1/1|'))
  check('single digest is passed through the result', single.digest.length === 64)

  const longValue = {
    title: '超长中日英 Emoji 包',
    prompts: Array.from({ length: 500 }, (_, index) => ({
      id: `prompt-${String(index).padStart(4, '0')}`,
      title: `架构评审 ${index} / prompt-${index} 🚀`,
      body: '中文备注、English notes、日本語メモ and 🎉 Emoji:'.repeat(6) + String(index),
    })),
  }
  const chunked = await createPacketFrames(longValue, { packageId: 'trip2026' })
  check('large package requires 10+ frames', chunked.mode === 'multi' && chunked.frames.length >= 10)
  await expectThrow('chunk size cannot exceed the declared QR limit', () =>
    createPacketFrames(longValue, {
      packageId: 'trip2027',
      chunkSize: 900,
      singleQrLimit: 800,
    }),
  )
  check(
    'compressed stream is split into 500-byte chunks except the tail',
    chunked.frameDetails.every((frame, index) => {
      const size = frame.bytes.byteLength
      return index === chunked.frameDetails.length - 1 ? size <= 500 : size === 500
    }),
  )
  check('frame CRC covers its own base64url payload', chunked.frameDetails.every(
    (frame) => frame.crc32 === crc32(frame.payloadB64),
  ))
  check('single digest equals existing signer output', chunked.digest === await sha256Hex(JSON.stringify(longValue)))

  const receiver = new PacketReceiver()
  const shuffled = [...chunked.frames]
  shuffled.reverse()
  await receiveAll(receiver, shuffled)
  check('out-of-order chunks reach the complete bitset', receiver.progress.received === chunked.frames.length)
  check('bitset progress reports 100%', receiver.progress.percent === 100)
  const roundTrip = await receiver.complete<typeof longValue>()
  check('gzip JSON round trip preserves the value', JSON.stringify(roundTrip) === JSON.stringify(longValue))

  const parsed = parsePacketFrame(chunked.frames[1] ?? '')
  check('parsed frame exposes the structured header', parsed.seq === 2 && parsed.total === chunked.frames.length)
  check('decoded frame bytes match the original compressed chunk', bytesEqual(
    parsed.bytes,
    chunked.frameDetails[1]?.bytes ?? new Uint8Array(),
  ))

  const parsedReceiver = new PacketReceiver()
  for (const frame of chunked.frameDetails) {
    parsedReceiver.receiveChunk(frame)
  }
  const parsedRoundTrip = await parsedReceiver.complete<typeof longValue>()
  check('parsed-frame receiver can also rebuild JSON', JSON.stringify(parsedRoundTrip) === JSON.stringify(longValue))

  const partialReceiver = new PacketReceiver()
  for (const [index, text] of chunked.frames.entries()) {
    if (index !== 2) partialReceiver.receiveChunk(text)
  }
  check('missing one frame keeps progress below 100%', partialReceiver.progress.received === chunked.frames.length - 1)
  await expectThrow('missing frame blocks completion', () => partialReceiver.complete())

  const goodFrame = chunked.frames[0] ?? ''
  const badCrcFrame = `${goodFrame.slice(0, -1)}A`
  await expectThrow('CRC mismatch is rejected', () => {
    new PacketReceiver().receiveChunk(badCrcFrame)
  })
  await expectThrow('non-KNAP input is rejected', () => {
    new PacketReceiver().receiveChunk('https://example.com')
  })
  await expectThrow('out-of-range sequence is rejected', () => {
    new PacketReceiver().receiveChunk('KNAP|trip2026|99/9|00000000|AAAA')
  })

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  if (failed > 0) process.exit(1)
}

void main()
