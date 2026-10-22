/**
 * AIMS Phase 1 真机 UI 验证
 * 重点：T0 远程收敛 / T1 发布寄语 / T2 修订角标 / T3 更多菜单
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { openApp, resetAndInject, gotoTeam, openTab, screenshotTo, sawText } from './lib/p7-run'
import { sleep } from './lib/p7-adb'
import { orgFixture, payloadOf, ORG_TEAM_ID } from './lib/p7-fixtures'

const OUT = 'scripts/out/aims-ui'
mkdirSync(OUT, { recursive: true })
const results: Array<{ name: string; ok: boolean; note?: string }> = []
function check(name: string, ok: boolean, note?: string) {
  results.push({ name, ok, note })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${note ? '  — ' + note : ''}`)
}

async function main() {
  const cdp = await openApp({ restart: true })
  console.log('app 已启动，CDP 已连')

  // ===== 注入组织者 fixture（含待审报告）=====
  const fx = orgFixture()
  const payload = payloadOf(fx)
  await resetAndInject(cdp, payload, [ORG_TEAM_ID])
  console.log('fixture 已注入')

  // ===== T0：远程过度设计已砍 —— 页面不应出现「远程」字样 =====
  await gotoTeam(cdp, ORG_TEAM_ID)
  await openTab(cdp, '会话与发布', '汇总会话')
  await sleep(800)
  let text = await cdp.text()
  check('T0：主机端无「远程主机」字样', !text.includes('远程主机'))
  check('T0：主机端无「刷新远程状态」按钮', !text.includes('刷新远程状态'))
  await screenshotTo(cdp, OUT, 't0-host-no-remote')

  // ===== T1：发布按钮存在且带说明提示 =====
  check('T1：发布按钮存在', text.includes('发布第'))
  // 细节 A：发布说明是点击发布后的 prompt 弹窗，不在静态页面文本中。
  // 验证方式：模拟点击发布按钮，检查 window.prompt 被调用且含「发布说明」
  const promptCalled = (await cdp.evalRaw(`(async () => {
    let called = false
    window.prompt = function(msg) { called = msg.includes('发布说明'); return null }
    const btns = [...document.querySelectorAll('button')]
    const pubBtn = btns.find((b) => b.innerText.includes('发布第'))
    if (pubBtn) pubBtn.click()
    await new Promise((r) => setTimeout(r, 500))
    return called
  })()`)) as boolean
  check('T1：点发布弹窗含「发布说明」提示', promptCalled === true)

  // ===== T3：「更多」折叠菜单收纳导出资料文件 =====
  const sawMore = await sawText(cdp, '更多', 5000)
  check('T3：会话卡片有「更多」按钮', sawMore)
  // 直接按钮不应再出现在头区
  check('T3：头区无「导出资料文件」直出按钮', !text.includes('导出资料文件'))
  await screenshotTo(cdp, OUT, 't3-host-more-menu')

  // ===== 切到「汇总与确认」tab：T2 修订角标 =====
  await openTab(cdp, '汇总与确认', '待审核报告')
  await sleep(800)
  text = await cdp.text()
  check('T2：待审核报告卡片存在', text.includes('待审核报告'))
  await screenshotTo(cdp, OUT, 't2-summary-tab')

  // ===== 切到「分工设置」tab：主按钮应只有高频项 =====
  await openTab(cdp, '分工设置', '名册')
  await sleep(600)
  text = await cdp.text()
  check('T3：分工设置页正常渲染', text.includes('名册') || text.includes('成员'))
  await screenshotTo(cdp, OUT, 't3-setup-tab')

  // ===== 成员端：T1 寄语卡片 + T3 更多菜单 =====
  await resetAndInject(cdp, payloadOf((await import('./lib/p7-fixtures')).memFixture()), [(await import('./lib/p7-fixtures')).MEM_TEAM_ID])
  await gotoTeam(cdp, (await import('./lib/p7-fixtures')).MEM_TEAM_ID)
  await sleep(1000)
  text = await cdp.text()
  check('成员端：任务区渲染', text.includes('我的任务'))
  const sawMemberMore = await sawText(cdp, '更多', 5000)
  check('T3：成员端有「更多」按钮', sawMemberMore)
  check('T3：成员端头区无「导入文件」直出按钮', !text.includes('导入文件'))
  await screenshotTo(cdp, OUT, 't3-member-more-menu')

  // ===== 汇总 =====
  const failed = results.filter((r) => !r.ok)
  console.log(`\n===== 汇总：${results.length - failed.length}/${results.length} 通过 =====`)
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ results, at: new Date().toISOString() }, null, 2))
  cdp.close()
  if (failed.length > 0) process.exit(1)
}

main().catch((e) => { console.error('脚本失败:', e); process.exit(1) })
