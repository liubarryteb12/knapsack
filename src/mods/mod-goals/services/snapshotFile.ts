/**
 * 快照落盘（BOARD_MODULE_SPEC §12.2 MCP-v1 导出文件桥的「落盘」一端）。
 *
 * - Tauri 桌面：fileBridge 弹系统「另存为」（默认文件名 knapsack-snapshot-<日期>.json），选哪存哪
 * - Android / Web：复用 fileBridge（写缓存 + 系统分享 / 浏览器下载）
 * 用户手动触发；快照含个人目标数据，落盘路径由用户在保存框自选。
 */
import { saveTextFile } from '../../../utils/fileBridge'

export const SNAPSHOT_FILENAME_PREFIX = 'knapsack-snapshot'

export function snapshotFilename(now = new Date()): string {
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  return `${SNAPSHOT_FILENAME_PREFIX}-${ymd}.json`
}

export interface SnapshotSaveResult {
  /** 已写入的完整路径（Tauri）；其他平台无 */
  path?: string
  /** fileBridge 非致命警告（Android 分享面板被取消等） */
  warning?: string
  /** 用户在保存框取消，未写盘 */
  cancelled?: boolean
}

export async function saveSnapshotFile(text: string): Promise<SnapshotSaveResult> {
  const filename = snapshotFilename()
  const result = await saveTextFile(filename, text)
  if (!result.ok) {
    if (result.cancelled) return { cancelled: true }
    throw new Error(result.error ?? '快照保存失败')
  }
  return { path: result.uri, ...(result.warning ? { warning: result.warning } : {}) }
}
