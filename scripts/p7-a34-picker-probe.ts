/**
 * 探针（A34 用）：打开应用成员页 → 点「导入文件」拉起真实系统选择器，
 * 然后按 --taps=标签1|标签2|... 依次点（每次点完 dump 一次 UI 并打印），用于摸清 MIUI DocumentsUI 的导航路径。
 * 只读探索，不改库；不写判定。
 * 用法：npx --no-install tsx scripts/p7-a34-picker-probe.ts --taps=显示根目录 --dump
 */
import { adb, adbTry, ensureDevice, sleep } from './lib/p7-adb'
import { openApp, resetAndInject, gotoTeam } from './lib/p7-run'
import { memFixture, MEM_TEAM_ID, payloadOf } from './lib/p7-fixtures'

const UI_XML = '/sdcard/p7ui.xml'
const arg = (n: string): string | null => {
  const hit = process.argv.slice(2).filter((a) => a.indexOf('--' + n + '=') === 0)[0]
  return hit ? hit.slice(n.length + 3) : null
}
const TAPS = (arg('taps') ?? '').split('|').map((s) => s.trim()).filter(Boolean)

function dump(): Array<{ label: string; bounds: string; center: { x: number; y: number } | null }> {
  adbTry(['shell', 'uiautomator', 'dump', UI_XML], { timeoutMs: 30_000 })
  const xml = adbTry(['shell', 'cat', UI_XML], { timeoutMs: 30_000 }).stdout
  const out: Array<{ label: string; bounds: string; center: { x: number; y: number } | null }> = []
  const re = /<node\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0]
    const a = (name: string): string => {
      const mm = new RegExp(name + '="([^"]*)"').exec(tag)
      return mm ? mm[1] : ''
    }
    const text = a('text')
    const desc = a('content-desc')
    if (!text && !desc) continue
    const bounds = a('bounds')
    const bm = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds)
    out.push({
      label: (text || desc).trim(),
      bounds,
      center: bm ? { x: Math.round((Number(bm[1]) + Number(bm[3])) / 2), y: Math.round((Number(bm[2]) + Number(bm[4])) / 2) } : null,
    })
  }
  return out
}

function fg(): string {
  const r = adbTry(['shell', 'dumpsys', 'activity', 'activities'], { timeoutMs: 40_000 })
  const line = r.stdout.split('\n').find((l) => /(?:top)?[Rr]esumedActivity/.test(l)) ?? ''
  const m = /([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/.exec(line)
  return m ? m[1] : '(未知)'
}

ensureDevice()
const cdp = await openApp({ restart: true })
await resetAndInject(cdp, payloadOf(memFixture(true)), [MEM_TEAM_ID])
await gotoTeam(cdp, MEM_TEAM_ID)
console.log('点「导入文件」=' + (await cdp.clickText('导入文件')))
await sleep(3000)
console.log('前台=' + fg())
for (const want of TAPS.length ? TAPS : ['(noop)']) {
  const nodes = dump()
  console.log('--- 当前 UI（' + nodes.length + ' 个有文本节点）前台=' + fg())
  console.log(nodes.map((n) => n.label + ' ' + n.bounds).join('\n'))
  if (want === '(noop)') break
  const hit = nodes.find((n) => n.label === want) ?? nodes.find((n) => n.label.indexOf(want) >= 0)
  if (!hit || !hit.center) {
    console.log('!! 找不到「' + want + '」，停止')
    break
  }
  console.log('>> tap ' + hit.label + ' @' + hit.center.x + ',' + hit.center.y)
  adb(['shell', 'input', 'tap', String(hit.center.x), String(hit.center.y)], { timeoutMs: 30_000 })
  await sleep(2000)
}
console.log('--- 结束前台=' + fg())
console.log('页面文本片段：' + (await cdp.text().catch(() => '')).slice(0, 300).replace(/\n/g, ' / '))
cdp.close()
