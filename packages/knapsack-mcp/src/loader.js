/**
 * 快照加载：路径解析（--snapshot / KNAPSACK_SNAPSHOT / 默认 ~/.knapsack/knapsack-snapshot.json）、
 * 读取、宽松校验。缺失或损坏不抛错，返回带引导文案的结果，由工具层原样转述。
 */
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { snapshotSchema, SNAPSHOT_FORMAT } from './snapshot.js'

export const DEFAULT_SNAPSHOT_PATH = path.join(os.homedir(), '.knapsack', 'knapsack-snapshot.json')

export function resolveSnapshotPath(argv = process.argv.slice(2), env = process.env) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--snapshot' && argv[i + 1]) return expandHome(argv[i + 1])
    if (arg.startsWith('--snapshot=')) return expandHome(arg.slice('--snapshot='.length))
  }
  if (env.KNAPSACK_SNAPSHOT) return expandHome(env.KNAPSACK_SNAPSHOT)
  return DEFAULT_SNAPSHOT_PATH
}

/** 配置里常写 ~/path，path.resolve 不认，这里补展开 */
function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return path.resolve(value)
}

/**
 * @returns {{ ok: true, snapshot: object, path: string, note?: string } | { ok: false, path: string, message: string }}
 */
export async function loadSnapshot(snapshotPath = DEFAULT_SNAPSHOT_PATH) {
  let text
  try {
    text = await readFile(snapshotPath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        ok: false,
        path: snapshotPath,
        message:
          `还没有工作区快照：${snapshotPath}\n` +
          '请打开 Knapsack，在「目标」页右上角点击「导出快照」，选择保存位置；' +
          '再用 --snapshot <路径> 参数或 KNAPSACK_SNAPSHOT 环境变量把本 server 指向该文件。',
      }
    }
    return { ok: false, path: snapshotPath, message: `读取快照失败：${error instanceof Error ? error.message : String(error)}` }
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, path: snapshotPath, message: `快照不是合法 JSON：${snapshotPath}。请重新从 App 导出。` }
  }

  if (json?.format !== SNAPSHOT_FORMAT) {
    return {
      ok: false,
      path: snapshotPath,
      message: `快照格式不匹配（期望 ${SNAPSHOT_FORMAT}，实际 ${json?.format ?? '未知'}）。请重新从 App 导出。`,
    }
  }

  const parsed = snapshotSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      path: snapshotPath,
      message: `快照校验失败：${issue?.path?.join('.') || '根'} ${issue?.message ?? ''}。请重新从 App 导出。`,
    }
  }

  return { ok: true, snapshot: parsed.data, path: snapshotPath, note: stalenessNote(parsed.data.createdAt) }
}

export function stalenessNote(createdAt, now = Date.now()) {
  const exported = Date.parse(createdAt)
  if (Number.isNaN(exported)) return undefined
  const days = Math.floor((now - exported) / 86_400_000)
  if (days < 7) return undefined
  return `注意：快照导出于 ${createdAt}，已 ${days} 天未更新；如需最新数据请重新导出。`
}
