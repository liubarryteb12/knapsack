/**
 * P6 真机文件往返验证（A34 的一部分）
 *
 * 在 Android WebView 内调用 Capacitor Filesystem/Share 插件，验证：
 * - 文本写入缓存目录后能读回（UTF-8 与 base64 两种编码），不是 Blob 演示；
 * - 写入返回 file:// 路径且落在应用私有目录（读回即从磁盘读取）；
 * - Share 插件可用（canShare），可把文件交给系统分享。
 *
 * 系统「选择文件」依赖用户点击系统选择器，无法自动点击，本脚本不覆盖，按手测项登记。
 *
 * 运行（设备已连、debug 构建）：
 *   npx tsx scripts/p6-device-file.ts
 */
import { execFileSync } from 'node:child_process'

const PKG = 'com.liubarryteb12.knapsack'

function adb(args: string[]): string {
  return execFileSync('adb', args, { encoding: 'utf8' })
}

function findDevtoolsSocket(): string {
  const out = adb(['shell', 'cat', '/proc/net/unix'])
  const line = out.split('\n').find((l) => l.includes('@webview_devtools_remote_'))
  if (!line) throw new Error('未找到应用 WebView 调试 socket')
  const m = line.match(/@(webview_devtools_remote_\d+)/)
  if (!m) throw new Error('无法解析 socket 名')
  return m[1]
}

interface CdpTarget {
  url: string
  webSocketDebuggerUrl: string
}

async function getTarget(): Promise<CdpTarget> {
  const res = await fetch('http://127.0.0.1:9222/json/list')
  const list = (await res.json()) as CdpTarget[]
  const page = list.find((t) => t.url.includes('localhost'))
  if (!page) throw new Error('未找到页面目标')
  return page
}

function evaluate(ws: WebSocket, id: number, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number
        result?: {
          result?: { value?: unknown }
          exceptionDetails?: { text?: string; exception?: { description?: string } }
        }
      }
      if (msg.id !== id) return
      ws.removeEventListener('message', onMsg)
      if (msg.result?.exceptionDetails) {
        reject(
          new Error(
            '页面异常：' +
              (msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text),
          ),
        )
        return
      }
      resolve(msg.result?.result?.value)
    }
    ws.addEventListener('message', onMsg)
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })
}

const TEXT = 'knapsack-p6-file-roundtrip-中文'
const B64_PLAIN = 'B64-PAYLOAD-测试'

const DEVICE_CHECK = `
(async () => {
  const C = window.Capacitor;
  const F = C && C.Plugins && C.Plugins.Filesystem;
  const S = C && C.Plugins && C.Plugins.Share;
  if (!F || !S) return { fatal: 'missing plugins', hasF: !!F, hasS: !!S };

  const out = {};
  // 1) UTF-8 文本写入 + 读回
  const w1 = await F.writeFile({ path: 'p6-check.team-public', data: ${JSON.stringify(TEXT)}, directory: 'CACHE', encoding: 'utf8', recursive: true });
  out.uri1 = w1.uri;
  const r1 = await F.readFile({ path: 'p6-check.team-public', directory: 'CACHE', encoding: 'utf8' });
  out.read1 = r1.data;

  // 2) base64 写入 + 按 utf8 读回（证明二进制通道也真实落盘）
  const b64 = btoa(unescape(encodeURIComponent(${JSON.stringify(B64_PLAIN)})));
  const w2 = await F.writeFile({ path: 'p6-check-b64.team-submit', data: b64, directory: 'CACHE' });
  out.uri2 = w2.uri;
  const r2 = await F.readFile({ path: 'p6-check-b64.team-submit', directory: 'CACHE', encoding: 'utf8' });
  out.read2 = r2.data;

  // 3) Share 能力探测（不弹面板，避免阻塞）
  const can = await S.canShare();
  out.canShare = can.value === true;

  // 4) 清理
  await F.deleteFile({ path: 'p6-check.team-public', directory: 'CACHE' });
  await F.deleteFile({ path: 'p6-check-b64.team-submit', directory: 'CACHE' });

  return out;
})()
`

async function main(): Promise<void> {
  console.log('== 重启应用并等待 WebView ==')
  adb(['shell', 'am', 'force-stop', PKG])
  adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`])
  await new Promise((r) => setTimeout(r, 3500))

  const sock = findDevtoolsSocket()
  adb(['forward', 'tcp:9222', `localabstract:${sock}`])
  const target = await getTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })

  console.log('== 设备侧：Filesystem 写入/读回 + Share 能力 ==')
  const res = (await evaluate(ws, 1, DEVICE_CHECK)) as {
    fatal?: string
    uri1?: string
    uri2?: string
    read1?: string
    read2?: string
    canShare?: boolean
  }
  ws.close()
  if (res.fatal) throw new Error(res.fatal)

  console.log('写入 uri1:', res.uri1)
  console.log('读回 1:', res.read1)
  console.log('写入 uri2:', res.uri2)
  console.log('读回 2:', res.read2)
  console.log('canShare:', res.canShare)

  const pass =
    res.read1 === TEXT &&
    res.read2 === B64_PLAIN &&
    res.canShare === true &&
    typeof res.uri1 === 'string' &&
    res.uri1.includes('/data/') &&
    res.uri1.includes(PKG)

  console.log('\n=== P6 真机文件往返 ===')
  console.log(
    pass
      ? '通过：Filesystem 文本/base64 写入读回真实往返，路径落在应用私有目录，Share 可用'
      : '存在未通过项',
  )
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
