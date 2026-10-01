/** 金额工具：一律整数分，禁止浮点金额运算 */

/** 分 → 元字符串，如 29200 → "292.00" */
export function fenToYuan(fen: number): string {
  const negative = fen < 0
  const abs = Math.abs(Math.trunc(fen))
  const yuan = Math.floor(abs / 100)
  const rest = abs % 100
  const s = `${yuan}.${String(rest).padStart(2, '0')}`
  return negative ? `-${s}` : s
}

/** 元（可含小数） → 分，"292.5" → 29250；非法输入返回 null */
export function yuanToFen(input: string): number | null {
  const s = input.trim().replace(/[¥￥,]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [yuanPart, decimalPart = ''] = s.split('.')
  const fen = Number(yuanPart) * 100 + Number((decimalPart + '00').slice(0, 2))
  return fen
}

/** 金额展示：分 → "¥292.00" */
export function formatFen(fen: number): string {
  return `¥${fenToYuan(fen)}`
}

/** 安全整数除法：向下取整，余数返回调用方处理 */
export function divMod(total: number, n: number): { quotient: number; remainder: number } {
  if (n <= 0) return { quotient: 0, remainder: total }
  const quotient = Math.floor(total / n)
  return { quotient, remainder: total - quotient * n }
}
