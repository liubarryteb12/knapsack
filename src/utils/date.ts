/** 日期工具：yyyy-MM-dd 本地日期处理，禁止用 toISOString()（UTC 偏移会错一天） */

/** Date → 本地 yyyy-MM-dd */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 本地 yyyy-MM-dd → 当天 00:00 的毫秒时间戳 */
export function fromDateStr(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getTime()
}

export function todayStr(): string {
  return toDateStr(new Date())
}

/** 加 n 天 */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

/** 两个日期间的天数（含首尾） */
export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}
