/**
 * P0 真机验证：通过 CDP 在 Android WebView 内驱动 TeamHost 插件，
 * 验证「原生 HTTP → JS handler → 落库后 completeRequest → HTTP 响应」链路。
 *
 * 运行（需设备已连、应用已在前台）：
 *   npx tsx scripts/p0-device-check.ts
 *
 * 验证项（对应 PLAN P0 与 A17/A19）：
 * 1. 插件在真机可用，start 返回可用端口
 * 2. handler 缺席时 /info 返回 504（事件发出 ≠ 成功，不伪造 ACK）
 * 3. 注册 handler 后 /info 返回 200 且 body 正确
 * 4. /action 的请求体完整传到 JS（base64 往返一致）
 * 5. 未知路径 404；停止后请求失败、端口释放
 */
import { execFileSync } from 'node:child_process'

const DEVICE_SOCKET_HINT = 'webview_devtools_remote'

function adb(args: string[]): string {
  return execFileSync('adb', args, { encoding: 'utf8' })
}

function findDevtoolsSocket(): string {
  const out = adb(['shell', 'cat', '/proc/net/unix'])
  const lines = out.split('\n').filter((l) => l.includes(DEVICE_SOCKET_HINT))
  // 取应用 WebView 的 socket（排除 @browser_webview_）
  const appLine = lines.find((l) => l.includes('@webview_devtools_remote_'))
  if (!appLine) throw new Error('未找到应用 WebView 调试 socket，确认应用在前台且为 debug 构建')
  const m = appLine.match(/@(webview_devtools_remote_\d+)/)
  if (!m) throw new Error('无法解析 socket 名')
  return m[1]
}

interface CdpTarget {
  id: string
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

/** 通过 CDP 在页面执行异步表达式并取回 JSON 结果 */
function evaluate(ws: WebSocket, id: number, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number
        result?: { result?: { value?: unknown }; exceptionDetails?: unknown }
      }
      if (msg.id !== id) return
      ws.removeEventListener('message', onMsg)
      if (msg.result?.exceptionDetails) {
        reject(new Error('页面执行异常：' + JSON.stringify(msg.result.exceptionDetails)))
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

const PAGE_SCRIPT = `
(async () => {
  const out = { steps: [], checks: {} };
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TeamHost;
  if (!P) { out.fatal = 'TeamHost 插件在 WebView 不可见'; return out; }
  out.steps.push('plugin-visible');

  const st = await P.start({ sessionId: 'cdp-p0', port: 0 });
  out.start = { running: st.running, port: st.port };
  const port = st.port;
  const base = 'http://127.0.0.1:' + port;

  // 2. handler 缺席：应 504（等原生超时）
  const t0 = Date.now();
  let noHandlerStatus = 0;
  try {
    const r = await fetch(base + '/info');
    noHandlerStatus = r.status;
  } catch (e) { noHandlerStatus = -1; }
  out.checks.handlerAbsentStatus = noHandlerStatus;
  out.checks.handlerAbsentMs = Date.now() - t0;

  // 3/4. 注册 handler
  const seen = { info: 0, actionLen: -1, unknownStatus: 0 };
  const listener = await P.addListener('teamRequest', async (evt) => {
    try {
      if (evt.path === '/info') {
        seen.info++;
        await P.completeRequest({
          requestId: evt.requestId,
          ok: true,
          body: JSON.stringify({ app: 'knapsack', protocol: 'knapsack-team/1', sessionId: evt.sessionId, teamName: 'CDP验证' }),
        });
        return;
      }
      if (evt.path === '/action') {
        // bodyB64 是标准 base64；解码后校验字节数
        const bin = atob(evt.bodyB64 || '');
        seen.actionLen = bin.length;
        await P.completeRequest({ requestId: evt.requestId, ok: true, body: JSON.stringify({ ok: true, result: { echoed: bin.length } }) });
        return;
      }
      await P.completeRequest({ requestId: evt.requestId, ok: false, body: 'not found' });
    } catch (e) {
      await P.completeRequest({ requestId: evt.requestId, ok: false, body: String(e) });
    }
  });

  // /info 200
  const r1 = await fetch(base + '/info');
  out.checks.infoStatus = r1.status;
  out.checks.infoBody = await r1.text();

  // /action 请求体往返（发 64 字节）
  const payload = new Uint8Array(64);
  for (let i = 0; i < 64; i++) payload[i] = i;
  const r2 = await fetch(base + '/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: payload,
  });
  out.checks.actionStatus = r2.status;
  out.checks.actionBody = await r2.text();
  out.checks.actionBytesSeenInJs = seen.actionLen;

  // 未知路径 404
  const r3 = await fetch(base + '/nope');
  out.checks.unknownPathStatus = r3.status;

  // CORS 预检
  const r4 = await fetch(base + '/action', { method: 'OPTIONS' });
  out.checks.optionsStatus = r4.status;

  await listener.remove();
  await P.stop();
  out.steps.push('stopped');

  // 5. 停止后请求应失败
  let afterStop = 0;
  try {
    const r5 = await fetch(base + '/info');
    afterStop = r5.status;
  } catch (e) { afterStop = -1; }
  out.checks.afterStopStatus = afterStop;

  return out;
})()
`

async function main(): Promise<void> {
  const sock = findDevtoolsSocket()
  console.log('devtools socket:', sock)
  adb(['forward', 'tcp:9222', `localabstract:${sock}`])
  console.log('adb forward tcp:9222 ->', sock)

  const target = await getTarget()
  console.log('page:', target.url)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })

  const result = (await evaluate(ws, 1, PAGE_SCRIPT)) as Record<string, unknown>
  console.log('\n=== 真机 P0 验证结果 ===')
  console.log(JSON.stringify(result, null, 2))
  ws.close()

  const checks = (result.checks ?? {}) as Record<string, unknown>
  const pass =
    checks.handlerAbsentStatus === 504 &&
    checks.infoStatus === 200 &&
    checks.actionStatus === 200 &&
    checks.actionBytesSeenInJs === 64 &&
    checks.unknownPathStatus === 404 &&
    checks.afterStopStatus === -1
  console.log(pass ? '\nP0 真机链路：通过' : '\nP0 真机链路：存在未通过项')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
