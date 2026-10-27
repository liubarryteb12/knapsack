/**
 * P7 单机验收总编排（默认 Redmi K20 Pro 69b31964，可用 P7_DEVICE 覆盖）
 *
 * 用法：
 *   npx tsx scripts/p7-device-single.ts                 # 跑全部（A28 A22 A30 A34 A35 E19）
 *   npx tsx scripts/p7-device-single.ts --only=A28,A22  # 只跑指定项
 *   npx tsx scripts/p7-device-single.ts --skip=A34      # 跳过指定项
 *   npx tsx scripts/p7-device-single.ts --out=scripts/out
 *
 * 退出码：0 = 无「失败」；1 = 至少一项「失败」；2 = 设备不可用/整体无法执行（各项记「无法执行」）。
 * 证据：scripts/out/p7-single-evidence-<时间戳>.json（含每项 evidence 与全部日志），截图也在 scripts/out/。
 */
import { ensureDevice, deviceInfo, restoreNetwork, getAirplaneMode } from './lib/p7-adb'
import { Recorder, nowIso, clip } from './lib/p7-report'
import { runA28 } from './p7-a28-restart'
import { runA22 } from './p7-a22-restore'
import { runA30 } from './p7-a30-offline'
import { runA34 } from './p7-a34-file'
import { runA35 } from './p7-a35-ui'
import { runE19 } from './p7-e19-launch-race'

type CaseId = 'A28' | 'A22' | 'A30' | 'A34' | 'A35' | 'E19'

const ALL: CaseId[] = ['A28', 'A22', 'A30', 'A34', 'A35', 'E19']

function argValue(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.indexOf('--' + name + '=') === 0)
  return hit ? hit.slice(name.length + 3) : null
}

function parseList(raw: string | null): CaseId[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is CaseId => (ALL as string[]).indexOf(s) >= 0)
}

async function main(): Promise<number> {
  const outDir = argValue('out') || 'scripts/out'
  const only = parseList(argValue('only'))
  const skip = parseList(argValue('skip'))
  const selected = (only.length > 0 ? only : ALL).filter((id) => skip.indexOf(id) < 0)

  const rec = new Recorder({ script: 'p7-device-single.ts', startedAt: nowIso() })
  rec.log('[P7] 选中项：' + selected.join(' '))
  rec.log('[P7] 输出目录：' + outDir)

  // 自检用：只加载全部 runner 模块并打印计划，不碰设备
  if (process.argv.indexOf('--dry-run') >= 0) {
    const mods = [
      ['p7-a28-restart', typeof runA28],
      ['p7-a22-restore', typeof runA22],
      ['p7-a30-offline', typeof runA30],
      ['p7-a34-file', typeof runA34],
      ['p7-a35-ui', typeof runA35],
      ['p7-e19-launch-race', typeof runE19],
    ] as const
    for (const [name, kind] of mods) console.log('[dry-run] 模块已加载 ' + name + ' → ' + kind)
    console.log('[dry-run] 将执行：' + selected.join(' → '))
    console.log('[dry-run] 输出目录：' + outDir)
    return 0
  }

  try {
    const serial = ensureDevice()
    rec.log('[P7] 设备：' + serial)
  } catch (e) {
    const reason = '设备不可用：' + (e instanceof Error ? e.message : String(e))
    rec.log('[P7] ' + reason)
    for (const id of selected) rec.blocked(id, 'P7 单机验收项 ' + id, reason, {})
    console.log(rec.summary())
    console.log('证据文件：' + rec.write(outDir, 'p7-single-evidence'))
    return 2
  }

  const dev = deviceInfo()
  rec.meta.device = dev as unknown as Record<string, unknown>
  rec.meta.app = { package: dev.appVersionName, code: dev.appVersionCode, lastUpdateTime: dev.lastUpdateTime }
  rec.log('[P7] 设备信息：' + JSON.stringify(dev))

  const runners: Record<CaseId, () => Promise<void>> = {
    A28: () => runA28(rec, outDir),
    A22: () => runA22(rec, outDir),
    A30: () => runA30(rec, outDir),
    A34: () => runA34(rec, outDir),
    A35: () => runA35(rec, outDir),
    E19: () => runE19(rec),
  }

  for (const id of selected) {
    rec.log('')
    rec.log('[P7] ===== ' + id + ' 开始 =====')
    try {
      await runners[id]()
    } catch (e) {
      rec.fail(id, 'P7 单机验收项 ' + id, '脚本异常中止：' + (e instanceof Error ? e.message : String(e)), {
        stack: clip(e instanceof Error ? e.stack : String(e), 2000),
      })
    }
    rec.log('[P7] ===== ' + id + ' 结束 =====')
  }

  // 兜底：任何分支都不要把设备留在断网状态
  try {
    const restored = restoreNetwork()
    rec.log('[P7] 网络兜底恢复：' + restored.join('；') + '；airplane_mode_on=' + getAirplaneMode())
  } catch (e) {
    rec.log('[P7] 网络兜底恢复失败：' + String(e))
  }

  console.log(rec.summary())
  console.log('证据文件：' + rec.write(outDir, 'p7-single-evidence'))
  return rec.exitCode
}

main().then((code) => process.exit(code))
