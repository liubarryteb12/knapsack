/**
 * P7 单机验收 · 结论记录与证据落盘
 *
 * 判定只有三种：通过 / 失败 / 无法执行（必须写原因）。脚本退出码：有「失败」则 1，否则 0。
 * 「无法执行」不算通过，也不算失败，但会在汇总里单列，台账里必须原样记录原因。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Verdict = '通过' | '失败' | '无法执行'

export interface CaseResult {
  /** A 编号，如 A22 */
  id: string
  title: string
  verdict: Verdict
  reason: string
  evidence: Record<string, unknown>
  at: string
}

export interface RunMeta {
  script: string
  startedAt: string
  device?: Record<string, unknown>
  app?: Record<string, unknown>
  extra?: Record<string, unknown>
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** 文件名用时间戳：2026-10-21T19-02-11 */
export function fileStamp(): string {
  return nowIso().replace(/\.\d+Z$/, '').replace(/[:]/g, '-')
}

/** 断言失败即抛错，由各脚本统一记为「失败」 */
export function requireTrue(cond: unknown, message: string): void {
  if (!cond) throw new Error(message)
}

export function requireEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(message + '（实际 ' + String(actual) + '，期望 ' + String(expected) + '）')
}

/** 截断长文本，避免证据文件过大 */
export function clip(text: unknown, max = 1200): string {
  const s = typeof text === 'string' ? text : JSON.stringify(text ?? null)
  if (s === undefined) return 'undefined'
  return s.length > max ? s.slice(0, max) + '…(' + s.length + ' chars)' : s
}

export class Recorder {
  readonly meta: RunMeta
  readonly cases: CaseResult[] = []
  readonly logs: string[] = []

  constructor(meta: RunMeta) {
    this.meta = meta
  }

  log(line: string): void {
    this.logs.push(line)
    console.log(line)
  }

  pass(id: string, title: string, evidence: Record<string, unknown> = {}, reason = ''): CaseResult {
    return this.add(id, title, '通过', reason, evidence)
  }

  fail(id: string, title: string, reason: string, evidence: Record<string, unknown> = {}): CaseResult {
    return this.add(id, title, '失败', reason, evidence)
  }

  blocked(id: string, title: string, reason: string, evidence: Record<string, unknown> = {}): CaseResult {
    return this.add(id, title, '无法执行', reason, evidence)
  }

  private add(id: string, title: string, verdict: Verdict, reason: string, evidence: Record<string, unknown>): CaseResult {
    const c: CaseResult = { id, title, verdict, reason, evidence, at: nowIso() }
    this.cases.push(c)
    console.log('[' + verdict + '] ' + id + ' ' + title + (reason ? ' —— ' + reason : ''))
    return c
  }

  get failed(): CaseResult[] {
    return this.cases.filter((c) => c.verdict === '失败')
  }

  get blockedCases(): CaseResult[] {
    return this.cases.filter((c) => c.verdict === '无法执行')
  }

  get passed(): CaseResult[] {
    return this.cases.filter((c) => c.verdict === '通过')
  }

  get exitCode(): number {
    return this.failed.length > 0 ? 1 : 0
  }

  summary(): string {
    const line = (c: CaseResult) => '  ' + c.id + '  ' + c.verdict + '  ' + c.title + (c.reason ? '  —— ' + c.reason : '')
    return [
      '',
      '===== 判定汇总（' + this.meta.script + '）=====',
      '通过 ' + this.passed.length + ' 项 / 失败 ' + this.failed.length + ' 项 / 无法执行 ' + this.blockedCases.length + ' 项',
      ...this.cases.map(line),
      '退出码：' + this.exitCode,
      '',
    ].join('\n')
  }

  toJSON(): Record<string, unknown> {
    return { meta: this.meta, cases: this.cases, logs: this.logs, exitCode: this.exitCode }
  }

  write(dir: string, prefix: string): string {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, prefix + '-' + fileStamp() + '.json')
    writeFileSync(path, JSON.stringify(this.toJSON(), null, 2), 'utf8')
    return path
  }
}
