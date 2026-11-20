/**
 * 快照落盘（BOARD_MODULE_SPEC §12.2 MCP-v1 导出文件桥的「落盘」一端）。
 *
 * - Tauri 桌面：dialog 插件弹保存框（默认文件名 knapsack-snapshot-<日期>.json），fs 插件写盘
 * - Android / Web：复用 fileBridge（写缓存 + 系统分享 / 浏览器下载）
 * 用户手动触发；快照含个人目标数据，落盘路径由用户在保存框自选。
 */
import { isTauri } from '@tauri-apps/api/core'
import { save, type SaveDialogOptions } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
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
  if (isTauri()) {
    const options: SaveDialogOptions = {
      title: '导出工作区快照',
      defaultPath: filename,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const path = await save(options)
    if (!path) return { cancelled: true } // 用户取消
    await writeTextFile(path, text)
    return { path }
  }
  const result = await saveTextFile(filename, text)
  if (!result.ok) throw new Error(result.error ?? '快照保存失败')
  return result.warning ? { warning: result.warning } : {}
}
