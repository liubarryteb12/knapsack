/**
 * P7 单机验收 · 共用编排工具
 *
 * 负责：起应用 + 连 CDP、注入/重置 fixture、读回 DB 快照做「重启前后对照」、截图落盘。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp } from './p7-cdp'
import { restartApp, deviceInfo, sleep, type DeviceInfo } from './p7-adb'
import { READ_STATE_EXPR, injectExpr, resetTeamsExpr } from './p7-page'

export interface DbState {
  teams: any[]
  publications: any[]
  outbox: any[]
  idempotency: any[]
  links: any[]
}

export interface FixturePayload {
  teams?: unknown[]
  publications?: unknown[]
  outbox?: unknown[]
  idempotency?: unknown[]
  links?: unknown[]
}

/** 起应用（可选重启）并连上 CDP */
export async function openApp(opts: { restart?: boolean } = {}): Promise<Cdp> {
  if (opts.restart !== false) await restartApp()
  return Cdp.attach()
}

export async function readState(cdp: Cdp): Promise<DbState> {
  return cdp.evalJson<DbState>(READ_STATE_EXPR)
}

export function teamOf(state: DbState, teamId: string): any {
  return state.teams.find((t) => t && t.teamId === teamId)
}

/** 把一个 teamId 的关键状态压成可打印、可对照的摘要 */
export function teamSnapshot(state: DbState, teamId: string): Record<string, any> {
  const t = teamOf(state, teamId)
  const publications = state.publications.filter((p) => p && p.meta && p.meta.teamId === teamId)
  const outbox = state.outbox.filter((o) => o && o.teamId === teamId)
  const receipts = state.idempotency.filter((i) => i && i.teamId === teamId && i.action === 'receipt.submit')
  return {
    teamId,
    found: Boolean(t),
    revision: t ? t.revision : null,
    draftRevision: t ? t.draftRevision : null,
    myMemberId: t ? t.myMemberId : null,
    latestVersion: t && t.latestPublication ? t.latestPublication.version : 0,
    latestDigest: t && t.latestPublication ? t.latestPublication.digest : null,
    historyVersions: t ? (t.publicationHistory || []).map((m: any) => m.version) : [],
    items: t ? (t.items || []).length : 0,
    allocations: t ? (t.allocations || []).length : 0,
    checkpoints: t ? (t.checkpoints || []).length : 0,
    expenses: t ? (t.expenses || []).map((e: any) => e.expenseReportId + '=' + e.amountFen) : [],
    submissionReviews: t ? (t.submissions || []).map((s: any) => s.submissionId + ':' + s.review) : [],
    publicationRows: publications.length,
    outboxRows: outbox.length,
    outboxIds: outbox.map((o) => o.operationId).sort(),
    outboxKinds: outbox.map((o) => o.kind).sort(),
    receiptRows: receipts.length,
    linkRows: state.links.filter((l) => l && l.teamId === teamId).length,
  }
}

/** 只比较字段值是否完全一致；返回差异列表（空数组=一致） */
export function diffSnapshot(before: Record<string, any>, after: Record<string, any>): string[] {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  const diffs: string[] = []
  for (const k of keys) {
    const a = JSON.stringify(before[k])
    const b = JSON.stringify(after[k])
    if (a !== b) diffs.push(k + ': ' + a + ' -> ' + b)
  }
  return diffs
}

/** 重置指定 teamId 的行 + 注入 fixture + 重载页面（让 Dexie/UI 重新读库） */
export async function resetAndInject(
  cdp: Cdp,
  payload: FixturePayload,
  resetTeamIds: string[],
): Promise<{ reset: any; inject: any }> {
  const reset = await cdp.evalJson<Record<string, unknown>>(resetTeamsExpr(resetTeamIds))
  const inject = await cdp.evalJson<Record<string, unknown>>(injectExpr(payload))
  await cdp.reload()
  await cdp.waitForApp()
  return { reset, inject }
}

/** 跳到团队详情并等到 meta 行渲染出来 */
export async function gotoTeam(cdp: Cdp, teamId: string): Promise<void> {
  await cdp.goto('#/team/' + teamId)
  await cdp.waitForText('名成员', 20_000)
}

/** 打开某个 tab（naive-ui n-tabs 的标签文本） */
export async function openTab(cdp: Cdp, label: string, expectText: string): Promise<void> {
  const ok = await cdp.clickText(label)
  if (!ok) throw new Error('找不到 tab：' + label)
  await cdp.waitForText(expectText, 15_000)
}

/** CDP 截图落盘，返回文件路径 */
export async function screenshotTo(cdp: Cdp, outDir: string, name: string): Promise<string> {
  mkdirSync(outDir, { recursive: true })
  const b64 = await cdp.screenshotBase64()
  const path = join(outDir, name)
  writeFileSync(path, Buffer.from(b64, 'base64'))
  return path
}

export function deviceAndApp(): { device: DeviceInfo } {
  return { device: deviceInfo() }
}

/** 等待某个 toast/文案出现（短超时，失败不抛） */
export async function sawText(cdp: Cdp, text: string, timeoutMs = 6_000): Promise<boolean> {
  try {
    return await cdp.waitForText(text, timeoutMs)
  } catch {
    return false
  }
}

export { sleep }

/** tsx 直接运行时判断入口（避免 import 时执行 main） */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1] || ''
  if (!entry) return false
  const normalized = entry.replace(/\\/g, '/')
  const self = metaUrl.replace(/\\/g, '/').replace('file:///', '')
  return normalized.endsWith(self.split('/').pop() || '###')
}
