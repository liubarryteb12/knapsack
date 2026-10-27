export interface CompositionInput {
  key: string
  amountCents: number
}

export interface CompositionAllocation extends CompositionInput {
  /** Integer thousandths: 334 means 33.4%. */
  permille: number
  percent: number
  percentText: string
}

interface MutableAllocation extends CompositionAllocation {
  remainder: bigint
  inputIndex: number
}

/**
 * Largest remainder allocation for one-decimal composition percentages.
 * All arithmetic stays in BigInt until the final safe integer conversion.
 */
export function computeComposition(inputs: readonly CompositionInput[]): CompositionAllocation[] {
  for (const input of inputs) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
      throw new Error(`金额必须是非负安全整数分：${input.key}`)
    }
    if (input.key.trim().length === 0) throw new Error('结构项 key 不能为空')
  }

  const total = inputs.reduce((sum, input) => sum + BigInt(input.amountCents), 0n)
  if (total === 0n) return []

  const allocations: MutableAllocation[] = inputs.map((input, inputIndex) => {
    const numerator = BigInt(input.amountCents) * 1000n
    const permille = Number(numerator / total)
    return {
      ...input,
      permille,
      percent: permille / 10,
      percentText: `${(permille / 10).toFixed(1)}%`,
      remainder: numerator % total,
      inputIndex,
    }
  })

  let difference = 1000 - allocations.reduce((sum, item) => sum + item.permille, 0)
  const ranked = [...allocations].sort((left, right) => {
    if (left.remainder === right.remainder) return left.inputIndex - right.inputIndex
    return left.remainder > right.remainder ? -1 : 1
  })
  for (let index = 0; index < difference; index++) {
    const target = ranked[index]
    if (!target) break
    target.permille++
    target.percent = target.permille / 10
    target.percentText = `${target.percent.toFixed(1)}%`
  }

  return allocations.map(({ remainder: _remainder, inputIndex: _inputIndex, ...allocation }) => allocation)
}
