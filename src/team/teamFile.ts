/**
 * 团队文件兜底（SPEC 9）
 *
 * 联网失败时用文件传递，但不冒充在线身份：
 * - `.team-public`：公共快照（team-publication.v1），导入只更新独立团队视图
 * - `.team-submit`：报告集合（team-submission.v1），主机需人工核对来源后再走同一审核入口
 * 文件不证明身份，checksum 只检测损坏，不是签名。
 */
import { z } from 'zod'
import { publicSnapshotSchema, submissionSchema, type PublicSnapshot, type Submission } from './schema'
import { TEAM_PUBLICATION_FORMAT, TEAM_SUBMISSION_FORMAT, TEAM_PUBLIC_EXT, TEAM_SUBMIT_EXT } from './protocol'
import { digestOf } from './domain'

export { TEAM_PUBLIC_EXT, TEAM_SUBMIT_EXT }

// ---------- 公共快照 ----------

export function serializePublicFile(snapshot: PublicSnapshot): string {
  const payload = { ...snapshot, format: TEAM_PUBLICATION_FORMAT as typeof TEAM_PUBLICATION_FORMAT }
  return JSON.stringify(payload, null, 2)
}

export function parsePublicFile(text: string): PublicSnapshot {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const obj = data as { format?: string }
  if (obj?.format !== TEAM_PUBLICATION_FORMAT) {
    throw new Error(`不支持的文件格式：${obj?.format ?? '未知'}。本应用只支持 ${TEAM_PUBLICATION_FORMAT}`)
  }
  return publicSnapshotSchema.parse(data)
}

// ---------- 报告文件 ----------

export const submissionFileSchema = z.object({
  format: z.literal(TEAM_SUBMISSION_FORMAT),
  teamId: z.string().min(1),
  /** 导出方标识（仅用于人工核对来源，不是身份证明） */
  exportedBy: z.string().default(''),
  exportedAt: z.number().int().min(0),
  submissions: z.array(submissionSchema),
})

export type SubmissionFile = z.infer<typeof submissionFileSchema>

export function serializeSubmissionFile(
  teamId: string,
  submissions: Submission[],
  exportedBy = '',
): string {
  const file: SubmissionFile = {
    format: TEAM_SUBMISSION_FORMAT,
    teamId,
    exportedBy,
    exportedAt: Date.now(),
    submissions,
  }
  return JSON.stringify(file, null, 2)
}

export function parseSubmissionFile(text: string): SubmissionFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const obj = data as { format?: string }
  if (obj?.format !== TEAM_SUBMISSION_FORMAT) {
    throw new Error(`不支持的文件格式：${obj?.format ?? '未知'}。本文件应为 ${TEAM_SUBMISSION_FORMAT}`)
  }
  return submissionFileSchema.parse(data)
}

// ---------- 导入结果 ----------

export interface PublicImportCheck {
  snapshot: PublicSnapshot
  /** 与本地当前版本对比的提示 */
  comparison: 'newer' | 'same' | 'older' | 'unknown'
  digestOk: boolean
}

/** 校验公共文件：格式 + digest 自洽 + 与本地版本比较 */
export function checkPublicImport(text: string, localVersion: number): PublicImportCheck {
  const snapshot = parsePublicFile(text)
  const recomputed = digestOf({ ...snapshot, digest: '' })
  const digestOk = recomputed === snapshot.digest
  const comparison =
    localVersion === 0
      ? 'unknown'
      : snapshot.version > localVersion
        ? 'newer'
        : snapshot.version === localVersion
          ? 'same'
          : 'older'
  return { snapshot, comparison, digestOk }
}

/** 报告文件去重：按 submissionId+revision 判重，返回可导入项与冲突项 */
export function dedupeSubmissions(
  incoming: Submission[],
  existing: Submission[],
): { fresh: Submission[]; duplicates: Submission[]; conflicts: Submission[] } {
  const fresh: Submission[] = []
  const duplicates: Submission[] = []
  const conflicts: Submission[] = []
  for (const s of incoming) {
    const hit = existing.find((e) => e.submissionId === s.submissionId)
    if (!hit) {
      fresh.push(s)
      continue
    }
    if (hit.revision === s.revision) {
      // 同 ID 同版本：内容一致视为重复，不一致视为冲突（不静默覆盖）
      const same = digestOf(hit) === digestOf(s)
      if (same) duplicates.push(s)
      else conflicts.push(s)
      continue
    }
    // 同 ID 不同版本：交由主机审核入口按 revision 规则处理
    fresh.push(s)
  }
  return { fresh, duplicates, conflicts }
}

// ---------- 文件名（读写搬运见 utils/fileBridge.ts） ----------

/** 生成带团队名与日期的文件名 */
export function publicFileName(teamName: string, version: number): string {
  const safe = teamName.replace(/[\\/:*?"<>|]/g, '_')
  return `${safe}-第${version}版${TEAM_PUBLIC_EXT}`
}

export function submissionFileName(teamName: string, memberName: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')
  const d = new Date().toISOString().slice(0, 10)
  return `${safe(teamName)}-${safe(memberName)}-${d}${TEAM_SUBMIT_EXT}`
}
