/**
 * 阶段12 验收：局域网会话的信封加密与扫码载荷。
 * 运行：npx tsx scripts/test-lansession.ts
 *
 * 末尾会打印一组「已知答案」向量（KAT），用于和 Rust 侧
 * `src-tauri/src/session.rs` 的单元测试对拍，确保两种语言实现的
 * AES-256-GCM 线格式完全一致。
 */
import {
  seal,
  open,
  sealJson,
  openJson,
  importKey,
  bytesToB64url,
  b64urlToBytes,
  buildJoinPayload,
  parseJoinPayload,
  SESSION_PROTOCOL,
} from '../src/utils/lanSessionProtocol'

let failed = 0
function expect(cond: boolean, label: string) {
  if (cond) console.log(`OK  ${label}`)
  else {
    console.error(`FAIL ${label}`)
    failed++
  }
}

async function expectThrow(fn: () => Promise<unknown> | unknown, label: string) {
  try {
    await fn()
    expect(false, `${label}（竟然没抛错）`)
  } catch (err) {
    expect(true, `${label} → ${err instanceof Error ? err.message : String(err)}`)
  }
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

const keyBytes = new Uint8Array(32).map((_, i) => i)
const keyB64 = bytesToB64url(keyBytes)

// ---- 1. 加解密往返 ----
const key = await importKey(keyB64)
const text = '行囊 · 局域网会话 ✓'
const textBytes = new TextEncoder().encode(text)
const sealed = await seal(key, textBytes)
expect(sealed.length === 12 + textBytes.length + 16, `信封长度 = nonce12 + 密文${textBytes.length} + tag16（实际 ${sealed.length}）`)
expect((await new Promise<boolean>((r) => open(key, sealed).then((p) => r(new TextDecoder().decode(p) === text)))), '往返解密得到原文')

// ---- 2. 每个报文 nonce 不同 ----
const a = await seal(key, new Uint8Array([1]))
const b = await seal(key, new Uint8Array([1]))
expect(toHex(a.subarray(0, 12)) !== toHex(b.subarray(0, 12)), '两次加密使用不同 nonce')

// ---- 3. 密钥不对必须失败 ----
const wrongKey = await importKey(bytesToB64url(new Uint8Array(32).map((_, i) => 255 - i)))
await expectThrow(() => open(wrongKey, sealed), '错误密钥解密被拒')

// ---- 4. 篡改必须失败（GCM 完整性） ----
const tampered = sealed.slice()
tampered[tampered.length - 1] ^= 0x01
await expectThrow(() => open(key, tampered), '密文被改一位即被拒')
await expectThrow(() => open(key, sealed.subarray(0, 20)), '截断报文被拒')

// ---- 5. JSON 信封 ----
const obj = { trip: { id: 't1', name: '杭州行', 金额: 12345 }, n: 1 }
const round = await openJson<typeof obj>(key, await sealJson(key, obj))
expect(round.trip.name === '杭州行' && round.n === 1, 'JSON 信封往返')

// ---- 6. 扫码载荷 ----
const payload = buildJoinPayload({ ip: '192.168.1.5', port: 51234, keyB64, sessionId: 'ab12cd' })
expect(payload.startsWith(`${SESSION_PROTOCOL}?`), '载荷带协议前缀')
const parsed = parseJoinPayload(payload)
expect(
  parsed.ip === '192.168.1.5' && parsed.port === 51234 && parsed.keyB64 === keyB64 && parsed.sessionId === 'ab12cd',
  '载荷解析字段一致',
)
expect(toHex(b64urlToBytes(parsed.keyB64)) === toHex(keyBytes), '密钥 base64url 往返一致')
expect(!keyB64.includes('+') && !keyB64.includes('/') && !keyB64.includes('='), '密钥编码无 +/ 与填充，放进 query 无需转义')

await expectThrow(() => parseJoinPayload('https://example.com'), '拒绝非行囊会话码')
await expectThrow(() => parseJoinPayload(`${SESSION_PROTOCOL}?ip=1.2.3.4&port=0&k=${keyB64}&s=x`), '拒绝非法端口')
await expectThrow(() => parseJoinPayload(`${SESSION_PROTOCOL}?ip=1.2.3.4&port=90&k=AAAA&s=x`), '拒绝长度不对的密钥')

// ---- 7. 已知答案向量（给 Rust 侧对拍） ----
const katKey = new Uint8Array(32).map((_, i) => i)
const katNonce = new Uint8Array(12).map((_, i) => i)
const katPlain = new TextEncoder().encode('knapsack-lan-session-kat')
const katKeyObj = await crypto.subtle.importKey('raw', katKey, { name: 'AES-GCM' }, false, ['encrypt'])
const katCt = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: katNonce }, katKeyObj, katPlain))
console.log('\n--- KAT（Rust 单元测试用）---')
console.log(`key      = ${toHex(katKey)}`)
console.log(`nonce    = ${toHex(katNonce)}`)
console.log(`plain    = ${toHex(katPlain)}`)
console.log(`ct||tag  = ${toHex(katCt)}`)

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 个用例失败`)
process.exit(failed === 0 ? 0 : 1)
