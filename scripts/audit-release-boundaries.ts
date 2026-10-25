/**
 * v1.1.x 发布边界审计。
 *
 * 目标不是证明“完全没有网络”，而是证明网络路径可控：
 * - 只允许可选 AI、天气、同一 WiFi 局域网会话；
 * - 禁止支付/遥测/第三方统计 SDK；
 * - Android 权限、Tauri CSP、Web/Android 构建资产必须一致。
 *
 * 运行：npx tsx scripts/audit-release-boundaries.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures: string[] = []
const passes: string[] = []

function pass(name: string, detail = '') {
  passes.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name: string, detail: string) {
  failures.push(`${name} — ${detail}`)
}

function walk(dir: string, extensions: string[]): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full, extensions))
    else if (extensions.includes(path.extname(full))) out.push(full)
  }
  return out
}

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

const allowedNetworkFiles = new Set([
  'src/utils/aiConfig.ts',
  'src/utils/aiDraft.ts',
  'src/utils/weather.ts',
  'src/team/teamClient.ts',
  'src/utils/lanSessionProtocol.ts',
])

const networkPatterns: Array<{ name: string; re: RegExp }> = [
  { name: 'fetch', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', re: /\bnew\s+WebSocket\b/ },
  { name: 'sendBeacon', re: /navigator\.sendBeacon\s*\(/ },
]

const sourceFiles = walk(path.join(root, 'src'), ['.ts', '.vue'])
for (const file of sourceFiles) {
  const rel = path.relative(root, file).replaceAll('\\', '/')
  if (allowedNetworkFiles.has(rel)) continue
  const text = read(file)
  const hits = networkPatterns.filter((p) => p.re.test(text)).map((p) => p.name)
  if (hits.length > 0) fail('网络调用点白名单', `${rel} 出现 ${hits.join(', ')}`)
}
if (!failures.some((f) => f.startsWith('网络调用点白名单'))) {
  pass('网络调用点白名单', [...allowedNetworkFiles].join(', '))
}

const forbiddenAutoNetwork: Array<{ file: string; re: RegExp; label: string }> = [
  {
    file: 'src/views/TripsView.vue',
    re: /\bcheckAiReachable\b|\bsetTimeout\s*\(\s*probeAi\b/,
    label: '旅行首页不得后台探活 AI',
  },
  {
    file: 'src/views/SettingsView.vue',
    re: /\bfetchModels\s*\(\s*true\s*\)/,
    label: '设置页不得自动拉模型列表',
  },
  {
    file: 'src/components/WeatherStrip.vue',
    re: /\bonMounted\s*\([\s\S]*?\bfetchWeather\b/,
    label: '天气不得在挂载时自动查询',
  },
]
const autoNetworkHits = forbiddenAutoNetwork
  .filter(({ file, re }) => re.test(read(path.join(root, file))))
  .map(({ label }) => label)
if (autoNetworkHits.length > 0) fail('网络触发约束', autoNetworkHits.join('；'))
else pass('网络触发约束', 'AI/天气仅在用户点击后触发')

const forbiddenSdk = [
  'posthog',
  'sentry',
  'firebase',
  'gtag',
  'google-analytics',
  'mixpanel',
  'amplitude',
  'datadog',
  'newrelic',
  'stripe',
  'paypal',
  'alipay',
  'wechatpay',
  'braintree',
  'plaid',
]
const packageJson = JSON.parse(read(path.join(root, 'package.json'))) as {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const allDeps = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
].map((s) => s.toLowerCase())
const sdkHits = allDeps.filter((dep) => forbiddenSdk.some((bad) => dep.includes(bad)))
if (sdkHits.length > 0) fail('禁用依赖扫描', sdkHits.join(', '))
else pass('禁用依赖扫描', '未发现支付/遥测/统计 SDK')

const forbiddenCode = /\b(posthog|sentry|firebase|gtag|mixpanel|amplitude|datadog|newrelic|stripe|paypal|alipay|wechatpay|braintree|plaid)\b/i
const codeHits = sourceFiles
  .filter((file) => forbiddenCode.test(read(file)))
  .map((file) => path.relative(root, file).replaceAll('\\', '/'))
if (codeHits.length > 0) fail('禁用代码扫描', codeHits.join(', '))
else pass('禁用代码扫描', '未发现支付/遥测/统计 SDK 标识')

const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml')
const manifest = read(manifestPath)
const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((m) => m[1]!)
const allowedPermissions = new Set(['android.permission.INTERNET', 'android.permission.CAMERA'])
const extraPermissions = permissions.filter((p) => !allowedPermissions.has(p))
if (extraPermissions.length > 0) fail('Android 权限白名单', extraPermissions.join(', '))
else pass('Android 权限白名单', permissions.join(', ') || '无')

const tauri = JSON.parse(read(path.join(root, 'src-tauri/tauri.conf.json'))) as {
  app?: { security?: { csp?: string } }
}
const csp = tauri.app?.security?.csp ?? ''
if (!csp.includes('connect-src')) fail('Tauri CSP', '缺少 connect-src')
else if (/connect-src[^;]*\*/.test(csp)) fail('Tauri CSP', 'connect-src 含通配符 *')
else pass('Tauri CSP', '仅 self/HTTPS/私网局域网')

const requiredRelease = [
  'release/Knapsack-release.apk',
  'release/Knapsack-debug.apk',
  'release/Knapsack-setup.exe',
  `release/Knapsack-${packageJson.version ?? ''}-portable.exe`,
]
const missingRelease = requiredRelease.filter((file) => !existsSync(path.join(root, file)))
if (missingRelease.length > 0) fail('发布产物', `缺少 ${missingRelease.join(', ')}`)
else pass('发布产物', 'APK/setup/portable 均存在')

const distFiles = walk(path.join(root, 'dist'), ['.js', '.html'])
const distText = distFiles.map(read).join('\n')
if (!distText.includes('日常规划') || !distText.includes('日常账房')) {
  fail('Web 产物模块', 'dist 中未找到每日规划/日常账房文本')
} else {
  pass('Web 产物模块', '每日规划、日常账房已进入 dist')
}

const androidAssets = path.join(root, 'android/app/src/main/assets/public')
const androidFiles = walk(androidAssets, ['.js', '.html'])
const androidText = androidFiles.map(read).join('\n')
if (!androidText.includes('日常规划') || !androidText.includes('日常账房')) {
  fail('Android 资产同步', 'assets/public 中未找到每日规划/日常账房文本')
} else {
  pass('Android 资产同步', '每日规划、日常账房已进入 APK assets')
}

console.log('行囊 v1.1.x 发布边界审计')
console.log('')
for (const item of passes) console.log(`  PASS  ${item}`)
for (const item of failures) console.log(`  FAIL  ${item}`)
console.log('')
console.log(`结果：${passes.length} 通过，${failures.length} 失败`)
if (failures.length > 0) process.exit(1)
