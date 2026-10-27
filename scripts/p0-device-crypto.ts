/**
 * P0 真机密码互操作验证（A20）
 *
 * 在 Android WebView 内用平台 Web Crypto 做 ECDH(P-256)+HKDF+AES-256-GCM，
 * 与 Node 侧（同一套 src/team/identity 实现）互通；并验证 AAD 不符被拒。
 *
 * 运行（设备已连、应用已在前台、debug 构建）：
 *   npx tsx scripts/p0-device-crypto.ts
 */
import { execFileSync } from 'node:child_process'
import {
  generateEcdhKeyPair,
  importEcdhPublicKey,
  deriveSessionKey,
  sealWithAad,
  openWithAad,
  buildAad,
  utf8,
  fromB64u,
} from '../src/mods/mod-team/domain/identity'

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
        result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }
      }
      if (msg.id !== id) return
      ws.removeEventListener('message', onMsg)
      if (msg.result?.exceptionDetails) {
        reject(new Error('页面异常：' + (msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text)))
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

/** WebView 内自包含的 ECDH+HKDF+AES-GCM 实现（不依赖应用模块，验证平台能力） */
const DEVICE_SETUP = `
(async () => {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TeamHost;
  if (!P) return { fatal: 'no plugin' };

  // 清理上次运行可能残留的 listener / 会话（脚本中途失败时不会走到收尾）
  if (window.__p0) {
    try { await window.__p0.listener.remove(); } catch (e) {}
    try { await window.__p0.P.stop(); } catch (e) {}
    window.__p0 = null;
  }
  try { await P.stop(); } catch (e) {}

  const st = await P.start({ sessionId: 'crypto-test', port: 0 });
  const port = st.port;

  const b64u = (b) => { let s=''; for (const x of b) s+=String.fromCharCode(x); return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); };
  const fromB64u = (s) => { const p = s.length%4===0?'':'='.repeat(4-(s.length%4)); const bin = atob(s.replace(/-/g,'+').replace(/_/g,'/')+p); const o = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) o[i]=bin.charCodeAt(i); return o; };
  const u8 = (s) => new TextEncoder().encode(s);

  const kp = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, false, ['deriveBits']);
  const myPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const myPub = b64u(myPubRaw);

  let peerKey = null;
  let sessionKey = null;
  const result = { port, myPub, decrypted: null, aadRejected: false };

  const listener = await P.addListener('teamRequest', async (evt) => {
    try {
      const q = new URLSearchParams((evt.path.split('?')[1]||''));
      const peerPub = q.get('c') || '';
      const peerKeyImported = await crypto.subtle.importKey('raw', fromB64u(peerPub), { name:'ECDH', namedCurve:'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name:'ECDH', public: peerKeyImported }, kp.privateKey, 256));
      const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt: u8('knapsack-team/1|'+evt.sessionId), info: u8('host<-client') }, ikm, 256);
      const key = await crypto.subtle.importKey('raw', new Uint8Array(bits), { name:'AES-GCM' }, false, ['encrypt','decrypt']);
      sessionKey = key;

      const body = fromB64u(evt.bodyB64 || '');
      const nonce = body.subarray(0,12);
      const ct = body.subarray(12);
      const aad = u8('knapsack-team/1|'+evt.sessionId+'|POST|/action');
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv: nonce, additionalData: aad }, key, ct);
      } catch (e) {
        result.aadRejected = true;
        await P.completeRequest({ requestId: evt.requestId, ok: false, body: 'aad mismatch' });
        return;
      }
      result.decrypted = new TextDecoder().decode(plain);

      // 用同一密钥加密响应
      const respNonce = crypto.getRandomValues(new Uint8Array(12));
      const respCt = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv: respNonce, additionalData: aad }, key, u8('device-ok:'+result.decrypted)));
      const out = new Uint8Array(12 + respCt.length);
      out.set(respNonce,0); out.set(respCt,12);
      await P.completeRequest({ requestId: evt.requestId, ok: true, body: b64u(out) });
    } catch (e) {
      await P.completeRequest({ requestId: evt.requestId, ok: false, body: String(e) });
    }
  });

  // 把句柄与结果挂到全局，供后续 evaluate 取用
  window.__p0 = { P, kp, listener, result, fromB64u, b64u, u8, get sessionKey(){ return sessionKey; } };
  return result;
})()
`

const DEVICE_FINISH = `
(async () => {
  const s = window.__p0;
  if (!s) return { fatal: 'no state' };
  await s.listener.remove();
  await s.P.stop();
  return { finished: true, decrypted: s.result.decrypted, aadRejected: s.result.aadRejected };
})()
`

async function main(): Promise<void> {
  const sock = findDevtoolsSocket()
  adb(['forward', 'tcp:9222', `localabstract:${sock}`])
  const target = await getTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })

  console.log('== 设备侧：启动主机并生成 ECDH 密钥 ==')
  const setup = (await evaluate(ws, 1, DEVICE_SETUP)) as { port: number; myPub: string; fatal?: string }
  if (setup.fatal) throw new Error(setup.fatal)
  console.log('设备端口:', setup.port)
  console.log('设备公钥长度:', setup.myPub.length)

  // 从设备端口映射到本机
  adb(['forward', `tcp:${setup.port}`, `tcp:${setup.port}`])
  const base = `http://127.0.0.1:${setup.port}`
  const sessionId = 'crypto-test'

  // Node 侧派生会话密钥（与设备同一算法）
  const nodeKeys = await generateEcdhKeyPair()
  const devicePub = await importEcdhPublicKey(setup.myPub)
  const nodeKey = await deriveSessionKey(nodeKeys.privateKey, devicePub, sessionId, 'host<-client')

  const aad = buildAad(sessionId, 'POST', '/action')
  const payload = 'node-says-hello'
  const sealed = await sealWithAad(nodeKey, utf8(payload), aad)

  const url = `${base}/action?c=${encodeURIComponent(nodeKeys.publicKeyB64u)}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: sealed,
    signal: AbortSignal.timeout(20000),
  })
  console.log('HTTP 状态:', resp.status)
  const respB64 = (await resp.text()).trim()
  if (resp.status !== 200) {
    console.log('设备返回的错误：', respB64)
    const dbg = await evaluate(ws, 9, 'JSON.stringify({decrypted: window.__p0 && window.__p0.result.decrypted, aad: window.__p0 && window.__p0.result.aadRejected})')
    console.log('设备侧状态：', dbg)
    ws.close()
    process.exit(1)
  }
  const respPlain = new TextDecoder().decode(await openWithAad(nodeKey, fromB64u(respB64), aad))
  console.log('设备解密内容:', (await evaluate(ws, 2, 'window.__p0.result.decrypted')) as string)
  console.log('Node 解出响应:', respPlain)

  // 反向验证：错误 AAD 应被设备拒绝
  const wrongAad = buildAad(sessionId, 'POST', '/wrong')
  const badSealed = await sealWithAad(nodeKey, utf8('should-fail'), wrongAad)
  const badResp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: badSealed,
    signal: AbortSignal.timeout(20000),
  })
  console.log('错误 AAD 的 HTTP 状态:', badResp.status)

  const fin = (await evaluate(ws, 3, DEVICE_FINISH)) as { decrypted: string; aadRejected: boolean }
  ws.close()

  const pass =
    resp.status === 200 &&
    respPlain === `device-ok:${payload}` &&
    fin.decrypted === payload &&
    fin.aadRejected === true &&
    badResp.status === 500

  console.log('\n=== P0 真机密码互操作 ===')
  console.log(pass ? '通过：ECDH/HKDF/AES-GCM 与 AAD 绑定在真机 WebView 与 Node 侧互操作一致' : '存在未通过项')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
