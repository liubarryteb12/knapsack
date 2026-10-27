export const MAX_SOURCE_BYTES = 20 * 1024 * 1024
export const MAX_THUMBNAIL_BYTES = 150 * 1024
export const MAX_THUMBNAIL_LONG_EDGE = 600
export const THUMBNAIL_QUALITY_STEPS = [0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4] as const

export type ThumbnailErrorCode =
  | 'not-image'
  | 'source-too-large'
  | 'decode-failed'
  | 'encode-failed'
  | 'invalid-output'
  | 'output-too-large'
  | 'unsupported-environment'

export class ThumbnailCompressionError extends Error {
  readonly code: ThumbnailErrorCode

  constructor(code: ThumbnailErrorCode, message: string) {
    super(message)
    this.name = 'ThumbnailCompressionError'
    this.code = code
  }
}

export interface DecodedThumbnailImage {
  readonly width: number
  readonly height: number
  close?(): void
}

export interface ThumbnailEncodeRequest {
  readonly image: DecodedThumbnailImage
  readonly width: number
  readonly height: number
  readonly mimeType: 'image/webp'
  readonly quality: number
}

export type ThumbnailDecoder = (source: Blob) => Promise<DecodedThumbnailImage>
export type ThumbnailEncoder = (request: ThumbnailEncodeRequest) => Promise<Blob>

export interface ThumbnailCompressorOptions {
  decode?: ThumbnailDecoder
  encode?: ThumbnailEncoder
  maxSourceBytes?: number
}

export interface ThumbnailCompressionResult {
  readonly blob: Blob
  readonly width: number
  readonly height: number
  readonly longEdge: number
  readonly quality: number
  readonly byteLength: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateSource(source: Blob, maxSourceBytes: number): void {
  if (!(source instanceof Blob)) {
    throw new ThumbnailCompressionError('not-image', 'The thumbnail source must be a Blob')
  }

  const mimeType = source.type.toLowerCase()
  if (!mimeType.startsWith('image/')) {
    throw new ThumbnailCompressionError(
      'not-image',
      `The thumbnail source is not an image: ${source.type || 'unknown MIME type'}`,
    )
  }

  if (source.size > maxSourceBytes) {
    const limitMiB = (maxSourceBytes / (1024 * 1024)).toFixed(2).replace(/\.?0+$/, '')
    throw new ThumbnailCompressionError(
      'source-too-large',
      `The original image exceeds the ${limitMiB}MiB source limit`,
    )
  }
}

function isDecodedImage(image: unknown): image is DecodedThumbnailImage {
  if (typeof image !== 'object' || image === null) return false
  const candidate = image as Partial<DecodedThumbnailImage>
  return (
    Number.isFinite(candidate.width) &&
    (candidate.width ?? 0) > 0 &&
    Number.isFinite(candidate.height) &&
    (candidate.height ?? 0) > 0
  )
}

function scaledDimensions(image: DecodedThumbnailImage) {
  const scale = Math.min(1, MAX_THUMBNAIL_LONG_EDGE / Math.max(image.width, image.height))
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  }
}

async function decodeWithBrowser(source: Blob): Promise<DecodedThumbnailImage> {
  if (typeof createImageBitmap !== 'function') {
    throw new ThumbnailCompressionError(
      'unsupported-environment',
      'createImageBitmap is unavailable in this environment',
    )
  }

  return createImageBitmap(source)
}

function createBrowserCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  throw new ThumbnailCompressionError(
    'unsupported-environment',
    'Neither OffscreenCanvas nor document canvas is available',
  )
}

async function encodeWithBrowser(request: ThumbnailEncodeRequest): Promise<Blob> {
  const canvas = createBrowserCanvas(request.width, request.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new ThumbnailCompressionError('encode-failed', 'A 2D canvas context is unavailable')
  }

  context.drawImage(request.image as CanvasImageSource, 0, 0, request.width, request.height)

  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: request.mimeType, quality: request.quality })
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new ThumbnailCompressionError('encode-failed', 'Canvas failed to encode WebP'))
      },
      request.mimeType,
      request.quality,
    )
  })
}

export async function compressThumbnail(
  source: Blob,
  options: ThumbnailCompressorOptions = {},
): Promise<ThumbnailCompressionResult> {
  const maxSourceBytes = options.maxSourceBytes ?? MAX_SOURCE_BYTES
  validateSource(source, maxSourceBytes)

  const decode = options.decode ?? decodeWithBrowser
  const encode = options.encode ?? encodeWithBrowser
  let image: DecodedThumbnailImage

  try {
    image = await decode(source)
  } catch (error) {
    if (error instanceof ThumbnailCompressionError) throw error
    throw new ThumbnailCompressionError(
      'decode-failed',
      `The image could not be decoded: ${errorMessage(error)}`,
    )
  }

  if (!isDecodedImage(image)) {
    try {
      const closableImage = image as Partial<DecodedThumbnailImage> | null
      closableImage?.close?.()
    } catch {
      // A close failure must not hide the decode contract error.
    }
    throw new ThumbnailCompressionError(
      'decode-failed',
      'The decoded image must have finite positive width and height',
    )
  }

  const { width, height } = scaledDimensions(image)
  const longEdge = Math.max(width, height)

  try {
    for (const quality of THUMBNAIL_QUALITY_STEPS) {
      let blob: Blob
      try {
        blob = await encode({
          image,
          width,
          height,
          mimeType: 'image/webp',
          quality,
        })
      } catch (error) {
        if (error instanceof ThumbnailCompressionError) throw error
        throw new ThumbnailCompressionError(
          'encode-failed',
          `The image could not be encoded at quality ${quality}: ${errorMessage(error)}`,
        )
      }

      if (!(blob instanceof Blob) || blob.type !== 'image/webp' || blob.size < 1) {
        throw new ThumbnailCompressionError(
          'invalid-output',
          'The encoder must return a non-empty image/webp Blob',
        )
      }

      if (blob.size <= MAX_THUMBNAIL_BYTES) {
        return {
          blob,
          width,
          height,
          longEdge,
          quality,
          byteLength: blob.size,
        }
      }
    }
  } finally {
    try {
      image.close?.()
    } catch {
      // A close failure must not hide the compression result or primary error.
    }
  }

  throw new ThumbnailCompressionError(
    'output-too-large',
    `The thumbnail exceeds ${MAX_THUMBNAIL_BYTES / 1024}KB after all quality steps`,
  )
}
