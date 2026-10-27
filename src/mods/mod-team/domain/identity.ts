/**
 * 团队身份与密码原语（P2）
 *
 * 设计原则（SPEC 6.2 / 6.3）：
 * - 不自创算法，只用平台成熟能力：P-256 ECDH + HKDF-SHA256 + AES-256-GCM + HMAC-SHA256。
 * - 二维码只含主机**临时**公钥，不含共享密钥：共享密钥 ≠ 成员身份（R04）。
 *   每个成员与主机各自 ECDH 派生独立会话密钥，成员之间互不可解密。
 * - 逐成员凭证 = HMAC(主机长期密钥, teamId|memberId|deviceId)；
 *   成员后续会话提交凭证，主机重算比对。凭证不进公共二维码。
 * - AAD 绑定会话/方法/消息类型，防跨会话与跨路径重放（A14/A16）。
 */

// ---------- 基础编码 ----------

export type Bytes = Uint8Array<ArrayBuffer>

export function toB64u(b: Uint8Array): string {
  let bin = ''
  for (const byte of b) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(s: string): Bytes {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function utf8(s: string): Bytes {
  return new TextEncoder().encode(s) as Bytes
}

// ---------- P-256 ECDH ----------

export interface EcdhKeyPair {
  publicKeyB64u: string
  /** 私钥仅在本机内存/存储中，绝不出现在二维码或请求里 */
  privateKey: CryptoKey
}

export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { publicKeyB64u: toB64u(raw), privateKey: kp.privateKey }
}

/** 导入对端公钥（raw 未压缩点，65 字节） */
export async function importEcdhPublicKey(b64u: string): Promise<CryptoKey> {
  const raw = fromB64u(b64u)
  if (raw.length !== 65) throw new Error('公钥格式不对：期望 65 字节未压缩 P-256 点')
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
}

/**
 * ECDH + HKDF-SHA256 派生 32 字节会话密钥。
 * salt 绑定 sessionId，info 绑定方向，保证双方派生一致且会话间不通用。
 */
export async function deriveSessionKey(
  myPrivateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  sessionId: string,
  info: string,
): Promise<CryptoKey> {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, myPrivateKey, 256),
  )
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: utf8(`knapsack-team/1|${sessionId}`),
      info: utf8(info),
    },
    ikm,
    256,
  )
  return crypto.subtle.importKey('raw', new Uint8Array(bits), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

// ---------- 带 AAD 的 AES-GCM 信封 ----------

/** 明文 → nonce(12) || ct || tag(16)；AAD 绑定会话/路径/类型 */
export async function sealWithAad(key: CryptoKey, plain: Bytes, aad: string): Promise<Bytes> {
  const nonce = randomBytes(12)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: utf8(aad) },
      key,
      plain,
    ),
  )
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce, 0)
  out.set(ct, 12)
  return out
}

/** AAD 不匹配 / 密钥不对 / 篡改都会抛错（A14：不处理、不返回成功） */
export async function openWithAad(key: CryptoKey, msg: Bytes, aad: string): Promise<Bytes> {
  if (msg.length < 28) throw new Error('报文过短')
  const nonce = msg.subarray(0, 12)
  const ct = msg.subarray(12)
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: utf8(aad) },
        key,
        ct,
      ),
    )
  } catch {
    throw new Error('解密失败：密钥不匹配、AAD 不符或报文被篡改')
  }
}

/**
 * AAD 构造：会话 + 方法 + 路径 [+ 消息类型 + 操作号]。
 *
 * SPEC 6.3 要求 AAD 绑定消息类型；旧实现以「类型在解密后才可读」为由
 * 省略了它。实际两侧在加密时都已知 type/operationId（发前构造、发后解出），
 * 因此把它们拼进 AAD，接收方解密时用同样的期望值构造 AAD——
 * 载荷里的类型字段若被篡改，GCM 认证会失败（纵深防御，防跨动作重放）。
 */
export function buildAad(
  sessionId: string,
  method: string,
  path: string,
  extra?: { type?: string; operationId?: string },
): string {
  const parts = [
    `knapsack-team/1`,
    sessionId,
    method,
    path,
    extra?.type ?? '',
    extra?.operationId ?? '',
  ]
  return parts.join('|')
}

// ---------- 逐成员凭证（HMAC-SHA256） ----------

/** 主机长期凭证密钥：仅主机 TeamState 内保存，绝不下发 */
export function generateCredentialSecret(): Bytes {
  return randomBytes(32)
}

async function hmacKey(secret: Uint8Array): Promise<CryptoKey> {
  const raw = secret.slice() as Bytes
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

/** 标准 base64 → 字节（原生插件 bodyB64 用标准 base64） */
export function base64ToBytes(s: string): Bytes {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 字节 → 标准 base64 */
export function bytesToBase64(b: Uint8Array): string {
  let bin = ''
  for (const byte of b) bin += String.fromCharCode(byte)
  return btoa(bin)
}

/** 凭证 = HMAC(secret, teamId|memberId|deviceId)，base64url */
export async function issueCredential(
  secret: Uint8Array,
  teamId: string,
  memberId: string,
  deviceId: string,
): Promise<string> {
  const key = await hmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(`${teamId}|${memberId}|${deviceId}`)))
  return toB64u(sig)
}

/** 常量时间比对，避免时序侧信道 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 校验凭证 */
export async function verifyCredential(
  secret: Uint8Array,
  teamId: string,
  memberId: string,
  deviceId: string,
  credential: string,
): Promise<boolean> {
  const expected = await issueCredential(secret, teamId, memberId, deviceId)
  return timingSafeEqual(expected, credential)
}

// ---------- 会话码载荷 ----------

/** 主机会话二维码：只含临时公钥与会话号，不含任何长期秘密 */
export interface HostSessionTicket {
  ip: string
  port: number
  sessionId: string
  teamId: string
  /** 主机临时 ECDH 公钥（base64url，65 字节） */
  hostPub: string
  /** 团队名，仅用于显示 */
  teamName: string
}

export const TEAM_TICKET_PREFIX = 'knapsack-team/1'

export function buildHostTicket(t: HostSessionTicket): string {
  const q = new URLSearchParams({
    ip: t.ip,
    port: String(t.port),
    s: t.sessionId,
    t: t.teamId,
    p: t.hostPub,
    n: t.teamName,
  })
  return `${TEAM_TICKET_PREFIX}?${q.toString()}`
}

export function parseHostTicket(text: string): HostSessionTicket {
  const raw = text.trim()
  const qi = raw.indexOf('?')
  if (qi < 0 || raw.slice(0, qi) !== TEAM_TICKET_PREFIX) throw new Error('这不是行囊团队会话码')
  const q = new URLSearchParams(raw.slice(qi + 1))
  const ip = q.get('ip') ?? ''
  const port = Number(q.get('port') ?? '')
  const sessionId = q.get('s') ?? ''
  const teamId = q.get('t') ?? ''
  const hostPub = q.get('p') ?? ''
  const teamName = q.get('n') ?? ''
  if (!ip || !Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('会话码里的地址或端口不合法')
  if (!sessionId || !teamId) throw new Error('会话码缺少会话号或团队标识')
  if (fromB64u(hostPub).length !== 65) throw new Error('会话码里的主机公钥格式不对')
  return { ip, port, sessionId, teamId, hostPub, teamName }
}
