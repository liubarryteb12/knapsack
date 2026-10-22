/**
 * E19 启动竞态复核：连续 3 次 adb shell am force-stop + am start，
 * 观察 logcat 是否复现 "Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')"。
 *
 * 每轮单独清空 logcat 后再启动，避免上一轮噪音混入；同时单独统计已知无关噪音
 * （safe area CSS 注入失败）以便区分。任一轮复现 → 本项判「失败」（说明竞态仍在）。
 */
import { Cdp } from './lib/p7-cdp'
import { adbTry, ensureDevice, forceStopApp, startApp, appPid, sleep, deviceInfo } from './lib/p7-adb'
import { Recorder, nowIso, clip } from './lib/p7-report'
import { isMain } from './lib/p7-run'

const TITLE = 'E19 启动竞态：3 次 force-stop + start 是否复现 triggerEvent 报错'
const NEEDLE = 'triggerEvent'
const ROUNDS = 3

function dumpLogcat(lines = 4000): string {
  const r = adbTry(['logcat', '-d', '-v', 'brief', '-t', String(lines)], { timeoutMs: 40_000 })
  return r.stdout
}

export async function runE19(rec: Recorder): Promise<void> {
  const ev: Record<string, any> = {}
  try {
    ensureDevice()
    ev.device = deviceInfo()
    const rounds: Array<Record<string, unknown>> = []
    let hitCount = 0

    for (let i = 1; i <= ROUNDS; i++) {
      adbTry(['logcat', '-c'])
      forceStopApp()
      await sleep(700)
      const startOut = startApp()
      await sleep(7000)
      const dump = dumpLogcat()
      const lines = dump.split('\n')
      const hitLines = lines.filter((l) => l.indexOf(NEEDLE) >= 0)
      const uncaught = lines.filter((l) => l.indexOf('Uncaught') >= 0)
      const consoleLines = lines.filter((l) => l.indexOf('Capacitor/Console') >= 0)
      const safeArea = consoleLines.filter((l) => l.indexOf('safe area') >= 0)
      const fatal = lines.filter((l) => /FATAL EXCEPTION|\bANR in\b/.test(l))
      if (hitLines.length > 0) hitCount++
      rounds.push({
        round: i,
        pid: appPid(),
        startOut: clip(startOut, 400),
        triggerEventHits: hitLines.length,
        triggerEventLines: hitLines.slice(0, 5).map((l) => clip(l, 300)),
        uncaughtLines: uncaught.slice(0, 5).map((l) => clip(l, 300)),
        consoleLineCount: consoleLines.length,
        safeAreaNoise: safeArea.length,
        fatal: fatal.slice(0, 5).map((l) => clip(l, 300)),
      })
      rec.log('[E19] 第 ' + i + ' 轮：triggerEvent 命中 ' + hitLines.length + ' 行，console 行 ' + consoleLines.length + '，safe-area 噪音 ' + safeArea.length)
    }
    ev.rounds = rounds
    ev.triggerEventRounds = hitCount

    // 启动完成后应用确实可用（避免「没报错」其实是因为根本没起来）
    const cdp = await Cdp.attach()
    try {
      const text = await cdp.text()
      ev.appUsable = { shell: text.length > 0, hasNav: text.indexOf('行囊') >= 0 || text.indexOf('Knapsack') >= 0, textSample: clip(text, 200) }
    } finally {
      cdp.close()
    }

    if (hitCount === 0) {
      rec.pass('E19', TITLE, { ...ev, notes: ['3 轮启动均未出现 triggerEvent 报错；已知无关噪音（safe area CSS）单列在 rounds 里。'] })
    } else {
      rec.fail('E19', TITLE, ROUNDS + ' 轮中有 ' + hitCount + ' 轮复现 triggerEvent 报错（启动竞态仍在）', ev)
    }
  } catch (e) {
    rec.fail('E19', TITLE, e instanceof Error ? e.message : String(e), {
      ...ev,
      stack: clip(e instanceof Error ? e.stack : String(e), 2000),
    })
  }
}

if (isMain(import.meta.url)) {
  const rec = new Recorder({ script: 'p7-e19-launch-race.ts', startedAt: nowIso() })
  await runE19(rec)
  console.log(rec.summary())
  console.log('证据文件：' + rec.write('scripts/out', 'p7-e19-evidence'))
  process.exit(rec.exitCode)
}
