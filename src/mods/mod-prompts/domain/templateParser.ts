export interface TemplateVariable {
  name: string
  defaultValue?: string
  options?: string[]
}

export interface TemplateVariableVariant {
  defaultValue?: string
  options?: string[]
}

export interface TemplateVariableConflict {
  name: string
  variants: TemplateVariableVariant[]
}

export interface TemplateParseResult {
  variables: TemplateVariable[]
  conflicts: TemplateVariableConflict[]
}

export interface TemplateRenderResult {
  text: string
  missingVariables: string[]
}

interface TemplatePlaceholder {
  name: string
  raw: string
  start: number
  end: number
  variant: TemplateVariableVariant
}

interface VariableState {
  variable: TemplateVariable
  variants: TemplateVariableVariant[]
  conflict?: TemplateVariableConflict
}

function findPlaceholderEnd(template: string, start: number): number {
  let nestedBraceDepth = 0

  for (let index = start + 2; index < template.length; index++) {
    const char = template[index]

    if (char === '{') {
      nestedBraceDepth++
      continue
    }

    if (char !== '}') continue

    if (nestedBraceDepth > 0) {
      nestedBraceDepth--
      continue
    }

    if (template[index + 1] === '}') return index + 2
  }

  return -1
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

function splitTopLevelOptions(value: string): string[] | null {
  const options: string[] = []
  let nestedBraceDepth = 0
  let segmentStart = 0
  let foundSeparator = false

  for (let index = 0; index < value.length; index++) {
    const char = value[index]

    if (char === '{') {
      nestedBraceDepth++
      continue
    }

    if (char === '}') {
      if (nestedBraceDepth > 0) nestedBraceDepth--
      continue
    }

    if (char !== '|' || nestedBraceDepth > 0) continue

    foundSeparator = true
    options.push(value.slice(segmentStart, index))
    segmentStart = index + 1
  }

  if (!foundSeparator) return null

  options.push(value.slice(segmentStart))
  return uniqueNonEmpty(options)
}

function parseVariant(content: string, colonIndex: number): TemplateVariableVariant {
  if (colonIndex < 0) return {}

  const value = content.slice(colonIndex + 1).trim()
  if (!value) return {}

  const options = splitTopLevelOptions(value)
  if (!options) return { defaultValue: value }

  return options.length > 0 ? { options } : {}
}

function parsePlaceholder(template: string, start: number, end: number): TemplatePlaceholder | null {
  const content = template.slice(start + 2, end - 2)
  const colonIndex = content.indexOf(':')
  const name = (colonIndex < 0 ? content : content.slice(0, colonIndex)).trim()

  if (!name || name.includes('{') || name.includes('}') || name.includes('|')) return null

  return {
    name,
    raw: template.slice(start, end),
    start,
    end,
    variant: parseVariant(content, colonIndex),
  }
}

function scanPlaceholders(template: string): TemplatePlaceholder[] {
  const placeholders: TemplatePlaceholder[] = []
  let searchFrom = 0

  while (searchFrom < template.length) {
    const start = template.indexOf('{{', searchFrom)
    if (start < 0) break

    const end = findPlaceholderEnd(template, start)
    if (end < 0) break

    const placeholder = parsePlaceholder(template, start, end)
    if (placeholder) placeholders.push(placeholder)
    searchFrom = end
  }

  return placeholders
}

function sameOptions(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false

  const rightSet = new Set(right)
  return left.every((option) => rightSet.has(option))
}

function sameVariant(left: TemplateVariableVariant, right: TemplateVariableVariant): boolean {
  const leftHasDefault = left.defaultValue !== undefined
  const rightHasDefault = right.defaultValue !== undefined
  if (leftHasDefault !== rightHasDefault) return false
  if (leftHasDefault && left.defaultValue !== right.defaultValue) return false

  if (left.options === undefined || right.options === undefined) {
    return left.options === undefined && right.options === undefined
  }

  return sameOptions(left.options, right.options)
}

function hasVariant(variants: TemplateVariableVariant[], candidate: TemplateVariableVariant): boolean {
  return variants.some((variant) => sameVariant(variant, candidate))
}

function isEmptyVariant(variant: TemplateVariableVariant): boolean {
  return variant.defaultValue === undefined && variant.options === undefined
}

function applyVariant(variable: TemplateVariable, variant: TemplateVariableVariant): void {
  if (variant.defaultValue !== undefined) variable.defaultValue = variant.defaultValue
  if (variant.options !== undefined) variable.options = [...variant.options]
}

export function parseTemplateVariables(template: string): TemplateParseResult {
  const variables: TemplateVariable[] = []
  const conflicts: TemplateVariableConflict[] = []
  const states = new Map<string, VariableState>()

  for (const placeholder of scanPlaceholders(template)) {
    let state = states.get(placeholder.name)

    if (!state) {
      const variable: TemplateVariable = { name: placeholder.name }
      state = {
        variable,
        variants: isEmptyVariant(placeholder.variant) ? [] : [{ ...placeholder.variant }],
      }
      applyVariant(variable, placeholder.variant)
      states.set(placeholder.name, state)
      variables.push(variable)
      continue
    }

    if (isEmptyVariant(placeholder.variant)) continue

    if (state.variants.length === 0) {
      state.variants.push({ ...placeholder.variant })
      applyVariant(state.variable, placeholder.variant)
      continue
    }

    if (hasVariant(state.variants, placeholder.variant)) continue

    state.variants.push({ ...placeholder.variant })

    if (!state.conflict) {
      state.conflict = {
        name: placeholder.name,
        variants: state.variants.map((variant) => ({ ...variant })),
      }
      conflicts.push(state.conflict)
    } else {
      state.conflict.variants.push({ ...placeholder.variant })
    }
  }

  return { variables, conflicts }
}

export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string>> = {},
): TemplateRenderResult {
  const parsed = parseTemplateVariables(template)
  const variablesByName = new Map(parsed.variables.map((variable) => [variable.name, variable]))
  const missingVariables: string[] = []
  const missingSet = new Set<string>()
  const parts: string[] = []
  let cursor = 0

  for (const placeholder of scanPlaceholders(template)) {
    parts.push(template.slice(cursor, placeholder.start))

    const provided = Object.prototype.hasOwnProperty.call(values, placeholder.name)
      ? values[placeholder.name]
      : undefined

    if (typeof provided === 'string' && provided.trim().length > 0) {
      parts.push(provided)
    } else {
      const variable = variablesByName.get(placeholder.name)

      if (variable?.defaultValue !== undefined) {
        parts.push(variable.defaultValue)
      } else {
        parts.push(placeholder.raw)
        if (!missingSet.has(placeholder.name)) {
          missingSet.add(placeholder.name)
          missingVariables.push(placeholder.name)
        }
      }
    }

    cursor = placeholder.end
  }

  parts.push(template.slice(cursor))
  return { text: parts.join(''), missingVariables }
}
