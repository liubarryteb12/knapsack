/**
 * 局域网会话 · 协议与信封加密（阶段12）
 *
 * 与 `src-tauri/src/session.rs` 必须严格一致，两边各写一遍、用同一组
 * 测试向量互相验证（见 scripts/test-lansession.ts 与 Rust 侧单元测试）。
 *
 * 报文格式：`nonce(12B) || AES-256-GCM 密文 || tag(16B)`
 * - 传输层是明文 HTTP，安全性完全由这层信封保证；
 * - 密钥 32 字节，随机生成，只出现在二维码里，不走网络明文；
 * - 每个报文一个随机 nonce；GCM 自带完整性校验，密文被改解密必失败。
 */

export const SESSION_PROTOCOL = 'knapsack-session/1'

const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

export interface SessionInfo {
  ip: string
  port: number
  /** base64url（无填充）的 32 字节会话密钥 */
  keyB64: string
  sessionId: string
  tripId: string
  tripName: string
}

// ---------- base64url ----------

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64url(b: Uint8Array): string {
  let bin = ''
  for (const byte of b) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------- 信封加密 ----------

export async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64urlToBytes(keyB64)
  if (raw.length !== KEY_LEN) {
    throw new Error(`会话密钥长度不对：期望 ${KEY_LEN} 字节，实际 ${raw.length}`)
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** 加密封装：随机 nonce + AES-GCM */
export async function seal(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain))
  const out = new Uint8Array(NONCE_LEN + ct.length)
  out.set(nonce, 0)
  out.set(ct, NONCE_LEN)
  return out
}

/** 解密校验：密钥不对或被篡改都会抛错 */
export async function open(key: CryptoKey, msg: Uint8Array): Promise<Uint8Array> {
  if (msg.length < NONCE_LEN + TAG_LEN) throw new Error('报文过短，不是合法的信封')
  const nonce = msg.subarray(0, NONCE_LEN)
  const ct = msg.subarray(NONCE_LEN)
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct))
  } catch {
    throw new Error('解密失败：密钥不匹配或报文被篡改')
  }
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<Uint8Array> {
  return seal(key, new TextEncoder().encode(JSON.stringify(value)))
}

export async function openJson<T>(key: CryptoKey, msg: Uint8Array): Promise<T> {
  const plain = await open(key, msg)
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    throw new Error('密文解出来不是合法 JSON')
  }
}

// ---------- 二维码载荷 ----------

/** 扫码载荷：`knapsack-session/1?ip=..&port=..&k=<密钥>&s=<会话号>` */
export function buildJoinPayload(info: Pick<SessionInfo, 'ip' | 'port' | 'keyB64' | 'sessionId'>): string {
  const q = new URLSearchParams({
    ip: info.ip,
    port: String(info.port),
    k: info.keyB64,
    s: info.sessionId,
  })
  return `${SESSION_PROTOCOL}?${q.toString()}`
}

export interface JoinTarget {
  ip: string
  port: number
  keyB64: string
  sessionId: string
}

/** 解析扫码结果；不是行囊会话码就抛错，给人话提示 */
export function parseJoinPayload(text: string): JoinTarget {
  const raw = text.trim()
  const qIndex = raw.indexOf('?')
  if (qIndex < 0 || raw.slice(0, qIndex) !== SESSION_PROTOCOL) {
    throw new Error('这不是行囊的局域网会话码')
  }
  const q = new URLSearchParams(raw.slice(qIndex + 1))
  const ip = q.get('ip') ?? ''
  const port = Number(q.get('port') ?? '')
  const keyB64 = q.get('k') ?? ''
  const sessionId = q.get('s') ?? ''
  if (!ip || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('会话码里的地址或端口不合法')
  }
  const keyBytes = b64urlToBytes(keyB64)
  if (keyBytes.length !== KEY_LEN) throw new Error('会话码里的密钥长度不对')
  return { ip, port, keyB64, sessionId }
}

export function baseUrl(t: Pick<JoinTarget, 'ip' | 'port'>): string {
  return `http://${t.ip}:${t.port}`
}

// ---------- 接入方（手机）请求 ----------

async function post(key: CryptoKey, url: string, payload: unknown): Promise<Uint8Array> {
  const body = await sealJson(key, payload)
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
    signal: AbortSignal.timeout(20000),
  })
  if (!resp.ok) {
    throw new Error(`主机返回 ${resp.status}${resp.status === 409 ? '（会话可能已关闭）' : ''}`)
  }
  return new Uint8Array(await resp.arrayBuffer())
}

/** 取主机共享的那份行程 */
export async function pullTrip(target: JoinTarget): Promise<unknown> {
  const key = await importKey(target.keyB64)
  const msg = await post(key, `${baseUrl(target)}/pull`, {})
  return openJson(key, msg)
}

/** 把自己的行程推给主机 */
export async function pushTrip(target: JoinTarget, trip: unknown): Promise<void> {
  const key = await importKey(target.keyB64)
  const msg = await post(key, `${baseUrl(target)}/push`, { trip })
  const res = await openJson<{ ok?: boolean }>(key, msg)
  if (!res.ok) throw new Error('主机未确认接收')
}

export interface HostHandshake {
  app: string
  protocol: string
  sessionId: string
  tripName: string
}

/** 明文握手：确认对面是行囊主机，并拿到它共享的行程名 */
export async function fetchInfo(target: JoinTarget, timeoutMs = 8000): Promise<HostHandshake> {
  const resp = await fetch(`${baseUrl(target)}/info`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!resp.ok) throw new Error(`主机返回 ${resp.status}`)
  const data = (await resp.json()) as HostHandshake
  if (data.app !== 'knapsack' || data.protocol !== SESSION_PROTOCOL) {
    throw new Error('对面不是行囊主机')
  }
  return data
}
