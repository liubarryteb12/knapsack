/**
 * mod-prompts thumbnail compressor contract.
 *
 * Run: node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-thumbnail-compressor.ts
 */
import {
  MAX_SOURCE_BYTES,
  MAX_THUMBNAIL_BYTES,
  ThumbnailCompressionError,
  compressThumbnail,
  type DecodedThumbnailImage,
  type ThumbnailEncodeRequest,
} from '../src/mods/mod-prompts/services/thumbnailCompressor'

let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`)
    return
  }

  failed++
  console.error(`FAIL  ${name}${detail ? `: ${detail}` : ''}`)
}

function imageBlob(type = 'image/png', size = 64) {
  return new Blob([new Uint8Array(size)], { type })
}

function webpBlob(size: number) {
  return new Blob([new Uint8Array(size)], { type: 'image/webp' })
}

async function expectError(
  name: string,
  action: () => Promise<unknown>,
  code: ThumbnailCompressionError['code'],
) {
  try {
    await action()
    check(name, false, 'expected an error')
  } catch (error) {
    check(
      name,
      error instanceof ThumbnailCompressionError && error.code === code,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    )
  }
}

async function testLandscapeResizeAndQualityRetry() {
  const encoded: ThumbnailEncodeRequest[] = []
  const decoded: DecodedThumbnailImage = { width: 2400, height: 1200 }
  let finalBlob: Blob | undefined
  const result = await compressThumbnail(imageBlob(), {
    decode: async () => decoded,
    encode: async (request) => {
      encoded.push(request)
      finalBlob = webpBlob(request.quality > 0.8 ? 180 * 1024 : 149 * 1024)
      return finalBlob
    },
  })

  check(
    'landscape long edge is resized to 600px with aspect ratio preserved',
    encoded.length === 2 &&
      encoded.every((request) => request.width === 600 && request.height === 300),
  )
  check(
    'landscape retries at the exact 0.82 then 0.76 quality steps',
    JSON.stringify(encoded.map((request) => request.quality)) ===
      JSON.stringify([0.82, 0.76]),
  )
  check(
    'encoder contract always requests image/webp',
    encoded.every((request) => request.mimeType === 'image/webp'),
  )
  check(
    'successful result reports final thumbnail metadata',
    result.blob === finalBlob &&
      result.width === 600 &&
      result.height === 300 &&
      result.longEdge === 600 &&
      result.quality === 0.76 &&
      result.byteLength === 149 * 1024,
  )
}

async function testPortraitResizeWithoutUpscale() {
  const portraitRequests: ThumbnailEncodeRequest[] = []
  await compressThumbnail(imageBlob(), {
    decode: async () => ({ width: 1200, height: 2400 }),
    encode: async (request) => {
      portraitRequests.push(request)
      return webpBlob(1024)
    },
  })

  check(
    'portrait long edge is resized to 600px',
    portraitRequests.length === 1 &&
      portraitRequests[0]?.width === 300 &&
      portraitRequests[0]?.height === 600,
  )

  const smallRequests: ThumbnailEncodeRequest[] = []
  await compressThumbnail(imageBlob(), {
    decode: async () => ({ width: 320, height: 240 }),
    encode: async (request) => {
      smallRequests.push(request)
      return webpBlob(1024)
    },
  })

  check(
    'images below 600px are not upscaled',
    smallRequests.length === 1 &&
      smallRequests[0]?.width === 320 &&
      smallRequests[0]?.height === 240,
  )
}

async function testQualityExhaustion() {
  const qualities: number[] = []

  await expectError(
    'all encoder qualities fail with an explicit output size error',
    () =>
      compressThumbnail(imageBlob(), {
        decode: async () => ({ width: 600, height: 600 }),
        encode: async (request) => {
          qualities.push(request.quality)
          return webpBlob(MAX_THUMBNAIL_BYTES + 1)
        },
      }),
    'output-too-large',
  )

  check(
    'quality retries cover the exact 0.82 to 0.4 sequence',
    JSON.stringify(qualities) ===
      JSON.stringify([0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4]),
    JSON.stringify(qualities),
  )
}

async function testInputValidation() {
  let decoded = false
  await expectError(
    'non-image blobs are rejected before decoding',
    () =>
      compressThumbnail(imageBlob('text/plain'), {
        decode: async () => {
          decoded = true
          return { width: 100, height: 100 }
        },
      }),
    'not-image',
  )
  check('non-image rejection never invokes the decoder', !decoded)

  let oversizedDecoded = false
  await expectError(
    'source blobs above the 20MiB original limit are rejected',
    () =>
      compressThumbnail(imageBlob('image/png', MAX_SOURCE_BYTES + 1), {
        decode: async () => {
          oversizedDecoded = true
          return { width: 100, height: 100 }
        },
      }),
    'source-too-large',
  )
  check('oversized source rejection never invokes the decoder', !oversizedDecoded)
}

async function testEncoderContractValidation() {
  await expectError(
    'encoder output must be WebP',
    () =>
      compressThumbnail(imageBlob(), {
        decode: async () => ({ width: 100, height: 100 }),
        encode: async () => new Blob([new Uint8Array(1)], { type: 'image/png' }),
      }),
    'invalid-output',
  )

  await expectError(
    'encoder exceptions are surfaced as explicit compression errors',
    () =>
      compressThumbnail(imageBlob(), {
        decode: async () => ({ width: 100, height: 100 }),
        encode: async () => {
          throw new Error('fake encoder exploded')
        },
      }),
    'encode-failed',
  )
}

async function main() {
  await testLandscapeResizeAndQualityRetry()
  await testPortraitResizeWithoutUpscale()
  await testQualityExhaustion()
  await testInputValidation()
  await testEncoderContractValidation()

  console.log(failed > 0 ? `\n${failed} check(s) failed` : '\nAll checks passed')
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
