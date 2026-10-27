import type { PromptItem, PromptSnippet } from '../schema'
import { CAMERA_MOVEMENT_LABELS } from '../schema'
import { renderTemplate } from './templateParser'

export type PromptComposeTarget =
  | 'WORK_PLAIN'
  | 'WORK_MARKDOWN'
  | 'WORK_JSON'
  | 'Midjourney'
  | 'SD_POSITIVE'
  | 'SD_NEGATIVE'
  | 'VIDEO_ZH'
  | 'VIDEO_EN'

export interface PromptComposeArgs {
  target: PromptComposeTarget
  variables?: Readonly<Record<string, string>>
  snippets?: readonly PromptSnippet[]
}

const ENGLISH_CAMERA_MOVEMENTS: Record<keyof typeof CAMERA_MOVEMENT_LABELS, string> = {
  STATIC: 'static camera',
  PAN_LEFT: 'pan left',
  PAN_RIGHT: 'pan right',
  TILT_UP: 'tilt up',
  TILT_DOWN: 'tilt down',
  DOLLY_IN: 'dolly in',
  DOLLY_OUT: 'dolly out',
  ORBIT: 'orbit',
  FPV_DRONE: 'FPV drone',
  DOLLY_ZOOM: 'dolly zoom',
  HANDHELD: 'handheld',
}

function rejectCrossModality(item: PromptItem, args: PromptComposeArgs): never {
  throw new TypeError(
    `compose target ${args.target} does not support modality ${item.modality}`,
  )
}

function composeWorkPrompt(item: PromptItem, args: PromptComposeArgs): string {
  if (item.modality !== 'WORK_LLM') return rejectCrossModality(item, args)

  const payload = item.payload
  const rendered = renderTemplate(payload.templateBody, args.variables ?? {}).text

  switch (args.target) {
    case 'WORK_PLAIN':
      return payload.systemRole ? `${payload.systemRole}\n\n${rendered}` : rendered
    case 'WORK_MARKDOWN':
      return payload.systemRole ? `# ${payload.systemRole}\n\n${rendered}` : rendered
    case 'WORK_JSON':
      return JSON.stringify(
        {
          systemRole: payload.systemRole,
          prompt: rendered,
          fewShotExamples: payload.fewShotExamples,
        },
        null,
        2,
      )
    default:
      return rejectCrossModality(item, args)
  }
}

function formatSnippetWeight(textEn: string, weight: number): string {
  return weight === 1 ? textEn : `(${textEn}:${String(weight)})`
}

function enabledSnippetTexts(
  item: PromptItem,
  snippets: readonly PromptSnippet[],
  weighted: boolean,
): string[] {
  if (item.modality !== 'IMAGE_GEN') return []

  const snippetsById = new Map(snippets.map((snippet) => [snippet.id, snippet]))
  const texts: string[] = []

  for (const active of item.payload.activeSnippets) {
    if (!active.enabled) continue
    const snippet = snippetsById.get(active.snippetId)
    if (!snippet) continue
    texts.push(weighted ? formatSnippetWeight(snippet.textEn, active.weight) : snippet.textEn)
  }

  return texts
}

function composeImagePrompt(item: PromptItem, args: PromptComposeArgs): string {
  if (item.modality !== 'IMAGE_GEN') return rejectCrossModality(item, args)

  const payload = item.payload

  if (args.target === 'SD_NEGATIVE') return payload.negativePrompt.trim()
  if (args.target === 'Midjourney' || args.target === 'SD_POSITIVE') {
    const weighted = args.target === 'SD_POSITIVE'
    const parts = [payload.positivePrompt.trim(), ...enabledSnippetTexts(item, args.snippets ?? [], weighted)]

    if (args.target === 'Midjourney') {
      const { aspectRatio, styleRef } = payload.imageParams
      if (aspectRatio) parts.push(`--ar ${aspectRatio}`)
      if (payload.negativePrompt.trim()) parts.push(`--no ${payload.negativePrompt.trim()}`)
      if (styleRef.trim()) parts.push(`--sref ${styleRef.trim()}`)
      parts.push('--v 6.1')
    }

    return parts.filter(Boolean).join(' ')
  }

  return rejectCrossModality(item, args)
}

function composeVideoPrompt(item: PromptItem, args: PromptComposeArgs): string {
  if (item.modality !== 'VIDEO_GEN') return rejectCrossModality(item, args)

  const payload = item.payload
  const english = args.target === 'VIDEO_EN'
  const cameraText = payload.cameraMovement
    .map((movement) =>
      english ? ENGLISH_CAMERA_MOVEMENTS[movement] : CAMERA_MOVEMENT_LABELS[movement],
    )
    .join(english ? ', ' : '，')

  const subjectLabel = english ? 'Subject and scene' : '主体与场景'
  const motionLabel = english ? 'Motion dynamics' : '动态'
  const cameraLabel = english ? 'Camera movement' : '运镜'
  const atmosphereLabel = english ? 'Atmosphere and lighting' : '氛围与光线'
  const labelSuffix = english ? ': ' : '：'

  return [
    `${subjectLabel}${labelSuffix}${payload.subjectAndScene.trim()}`,
    payload.motionDynamics.trim() ? `${motionLabel}${labelSuffix}${payload.motionDynamics.trim()}` : '',
    cameraText ? `${cameraLabel}${labelSuffix}${cameraText}` : '',
    payload.atmosphereAndLighting.trim()
      ? `${atmosphereLabel}${labelSuffix}${payload.atmosphereAndLighting.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function composePrompt(item: PromptItem, args: PromptComposeArgs): string {
  switch (args.target) {
    case 'WORK_PLAIN':
    case 'WORK_MARKDOWN':
    case 'WORK_JSON':
      return composeWorkPrompt(item, args)
    case 'Midjourney':
    case 'SD_POSITIVE':
    case 'SD_NEGATIVE':
      return composeImagePrompt(item, args)
    case 'VIDEO_ZH':
    case 'VIDEO_EN':
      return composeVideoPrompt(item, args)
    default: {
      throw new TypeError(`unknown compose target ${(args as { target?: unknown }).target}`)
    }
  }
}
