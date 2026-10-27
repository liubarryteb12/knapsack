import { z } from 'zod'

export const PROMPT_MODALITIES = ['WORK_LLM', 'IMAGE_GEN', 'VIDEO_GEN'] as const
export const promptModalitySchema = z.enum(PROMPT_MODALITIES)
export type PromptModality = z.infer<typeof promptModalitySchema>

const facetListSchema = z
  .array(z.string().trim().min(1))
  .default([])
  .refine((items) => new Set(items).size === items.length, '分面标签不能重复')

export const promptFacetsSchema = z.object({
  targetTool: facetListSchema,
  domainTheme: facetListSchema,
  styleTechnique: facetListSchema,
})

export const promptHistoryEntrySchema = z.object({
  version: z.number().int().min(1),
  updatedAt: z.number().int().min(0),
  summary: z.string().max(200),
})

const promptBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, '标题不能为空').max(160),
  facets: promptFacetsSchema,
  isFavorite: z.boolean().default(false),
  usageCount: z.number().int().min(0).default(0),
  version: z.number().int().min(1).default(1),
  history: z.array(promptHistoryEntrySchema).max(10).default([]),
  coverMediaId: z.string().min(1).optional(),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})

export const outputFormatSchema = z.enum(['MARKDOWN', 'JSON', 'TABLE', 'CODE', 'PLAIN'])

export const workPromptPayloadSchema = z.object({
  systemRole: z.string().max(20_000).default(''),
  templateBody: z.string().min(1, '模板正文不能为空').max(20_000),
  fewShotExamples: z
    .array(
      z.object({
        input: z.string(),
        output: z.string(),
      }),
    )
    .max(20)
    .default([]),
  outputFormat: outputFormatSchema.default('PLAIN'),
})

export const promptSnippetRefSchema = z.object({
  snippetId: z.string().min(1),
  enabled: z.boolean().default(true),
  weight: z.number().min(0.1).max(2).default(1),
})

export const imageAspectRatioSchema = z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'])

export const imagePromptPayloadSchema = z.object({
  positivePrompt: z.string().min(1, '正向提示词不能为空').max(20_000),
  positivePromptZh: z.string().max(20_000).default(''),
  negativePrompt: z.string().max(20_000).default(''),
  activeSnippets: z
    .array(promptSnippetRefSchema)
    .default([])
    .refine(
      (items) => new Set(items.map((item) => item.snippetId)).size === items.length,
      '同一词块不能重复引用',
    ),
  imageParams: z
    .object({
      aspectRatio: imageAspectRatioSchema.optional(),
      targetModel: z.string().max(80).default(''),
      styleRef: z.string().max(500).default(''),
      chaos: z.number().min(0).max(100).optional(),
      stylize: z.number().min(0).max(1000).optional(),
      seed: z.string().max(80).default(''),
    })
    .default({
      targetModel: '',
      styleRef: '',
      seed: '',
    }),
})

export const CAMERA_MOVEMENTS = [
  'STATIC',
  'PAN_LEFT',
  'PAN_RIGHT',
  'TILT_UP',
  'TILT_DOWN',
  'DOLLY_IN',
  'DOLLY_OUT',
  'ORBIT',
  'FPV_DRONE',
  'DOLLY_ZOOM',
  'HANDHELD',
] as const
export const cameraMovementSchema = z.enum(CAMERA_MOVEMENTS)

export const videoPromptPayloadSchema = z.object({
  subjectAndScene: z.string().min(1, '主体与环境不能为空').max(20_000),
  motionDynamics: z.string().max(20_000).default(''),
  cameraMovement: z.array(cameraMovementSchema).max(4).default([]),
  atmosphereAndLighting: z.string().max(20_000).default(''),
  videoParams: z
    .object({
      durationSec: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
      aspectRatio: z.enum(['16:9', '9:16', '21:9']).optional(),
      fps: z.number().int().min(1).max(120).optional(),
      requiresStartEndFrame: z.boolean().default(false),
      frameNotes: z.string().max(2_000).default(''),
    })
    .default({
      requiresStartEndFrame: false,
      frameNotes: '',
    }),
})

export const promptItemSchema = z.discriminatedUnion('modality', [
  promptBaseSchema.extend({
    modality: z.literal('WORK_LLM'),
    payload: workPromptPayloadSchema,
  }),
  promptBaseSchema.extend({
    modality: z.literal('IMAGE_GEN'),
    payload: imagePromptPayloadSchema,
  }),
  promptBaseSchema.extend({
    modality: z.literal('VIDEO_GEN'),
    payload: videoPromptPayloadSchema,
  }),
])

export const promptSnippetCategorySchema = z.enum([
  'STYLE',
  'LIGHTING',
  'SHOT',
  'QUALITY',
  'CAMERA',
  'PARAM',
])

export const promptSnippetSchema = z.object({
  id: z.string().min(1),
  category: promptSnippetCategorySchema,
  labelZh: z.string().trim().min(1).max(80),
  labelEn: z.string().max(120).default(''),
  textEn: z.string().trim().min(1).max(1_000),
  defaultWeight: z.number().min(0.1).max(2).default(1),
  usageCount: z.number().int().min(0).default(0),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})

const MAX_THUMBNAIL_BYTES = 150 * 1024

export const promptMediaSchema = z
  .object({
    mediaId: z.string().min(1),
    itemId: z.string().min(1).nullable().default(null),
    blob: z.instanceof(Blob),
    mimeType: z.literal('image/webp'),
    byteLength: z.number().int().min(1).max(MAX_THUMBNAIL_BYTES),
    longEdge: z.number().int().min(1).max(600),
    createdAt: z.number().int().min(0),
  })
  .refine((media) => media.byteLength === media.blob.size, {
    message: 'byteLength 必须与 Blob 实际大小一致',
    path: ['byteLength'],
  })

export const PROMPT_MODALITY_LABELS: Record<PromptModality, string> = {
  WORK_LLM: '干工作',
  IMAGE_GEN: 'AI 生图',
  VIDEO_GEN: 'AI 生视频',
}

export const OUTPUT_FORMAT_LABELS: Record<z.infer<typeof outputFormatSchema>, string> = {
  MARKDOWN: 'Markdown',
  JSON: 'JSON',
  TABLE: '表格',
  CODE: '代码',
  PLAIN: '纯文本',
}

export const CAMERA_MOVEMENT_LABELS: Record<(typeof CAMERA_MOVEMENTS)[number], string> = {
  STATIC: '固定镜头',
  PAN_LEFT: '向左摇镜',
  PAN_RIGHT: '向右摇镜',
  TILT_UP: '向上仰拍',
  TILT_DOWN: '向下俯拍',
  DOLLY_IN: '缓慢推近',
  DOLLY_OUT: '缓慢拉远',
  ORBIT: '环绕运镜',
  FPV_DRONE: 'FPV 无人机',
  DOLLY_ZOOM: '希区柯克变焦',
  HANDHELD: '手持跟拍',
}

export type PromptItem = z.infer<typeof promptItemSchema>
export type WorkPromptItem = Extract<PromptItem, { modality: 'WORK_LLM' }>
export type ImagePromptItem = Extract<PromptItem, { modality: 'IMAGE_GEN' }>
export type VideoPromptItem = Extract<PromptItem, { modality: 'VIDEO_GEN' }>
export type PromptFacets = z.infer<typeof promptFacetsSchema>
export type PromptSnippetRef = z.infer<typeof promptSnippetRefSchema>
export type PromptSnippet = z.infer<typeof promptSnippetSchema>
export type PromptSnippetCategory = z.infer<typeof promptSnippetCategorySchema>
export type PromptMediaRecord = z.infer<typeof promptMediaSchema>
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number]
