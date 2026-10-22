/**
 * P7 单机真机验收 · 页面侧脚本片段（在 WebView 内执行）
 *
 * 只依赖 WebView 原生能力（IndexedDB / DOM / WebCrypto），不依赖打包后 minify 的模块导出。
 * 所有片段都是「表达式」，返回 JSON 字符串，Node 侧用 Cdp.evalJson 解析。
 * 注意：PAGE_LIB / CRYPTO_LIB 是被拼接进页面执行的源码文本，本身不做 TS 检查。
 */

/** 通用页面工具：IDB 读写、点击、按标签填值、toast 文本、存储扫描、对比度 */
export const PAGE_LIB = "\nconst p7sleep = (ms) => new Promise((r) => setTimeout(r, ms));\nconst p7openDb = () => new Promise((res, rej) => {\n  const r = indexedDB.open('knapsack');\n  r.onsuccess = () => res(r.result);\n  r.onerror = () => rej(r.error);\n});\nconst p7putRows = (db, store, rows) => new Promise((res, rej) => {\n  if (!rows || !rows.length) return res(0);\n  const tx = db.transaction([store], 'readwrite');\n  const os = tx.objectStore(store);\n  for (const row of rows) os.put(row);\n  tx.oncomplete = () => res(rows.length);\n  tx.onerror = () => rej(tx.error || new Error('put error'));\n  tx.onabort = () => rej(tx.error || new Error('put abort'));\n});\nconst p7all = (db, store) => new Promise((res, rej) => {\n  const tx = db.transaction([store], 'readonly');\n  const rq = tx.objectStore(store).getAll();\n  rq.onsuccess = () => res(rq.result || []);\n  rq.onerror = () => rej(rq.error);\n});\nconst p7text = () => document.body.innerText;\nconst p7toasts = () => Array.from(document.querySelectorAll('.n-message__content, .n-message'))\n  .map((e) => (e.innerText || '').trim()).filter(Boolean);\nconst p7clickText = (want) => {\n  const els = Array.from(document.querySelectorAll('button, a, .n-button, .n-tabs-tab, [role=\"button\"]'));\n  const hit = els.find((e) => ((e.innerText || e.textContent || '').trim()) === want);\n  if (!hit) return false;\n  hit.click();\n  return true;\n};\nconst p7clickRe = (src) => {\n  const re = new RegExp(src);\n  const els = Array.from(document.querySelectorAll('button, a, .n-button, .n-tabs-tab, [role=\"button\"]'));\n  const hit = els.find((e) => re.test(((e.innerText || e.textContent || '').trim())));\n  if (!hit) return false;\n  hit.click();\n  return true;\n};\nconst p7setNativeValue = (el, value) => {\n  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;\n  const desc = Object.getOwnPropertyDescriptor(proto, 'value');\n  desc.set.call(el, value);\n  el.dispatchEvent(new Event('input', { bubbles: true }));\n  el.dispatchEvent(new Event('change', { bubbles: true }));\n  return true;\n};\nconst p7formItem = (label) => {\n  const items = Array.from(document.querySelectorAll('.n-form-item'));\n  return items.find((it) => {\n    const l = it.querySelector('.n-form-item-label');\n    return l && (l.innerText || '').trim().indexOf(label) === 0;\n  }) || null;\n};\nconst p7fillByLabel = (label, value) => {\n  const it = p7formItem(label);\n  if (!it) return false;\n  const el = it.querySelector('textarea, input');\n  if (!el) return false;\n  return p7setNativeValue(el, value);\n};\nconst p7readByLabel = (label) => {\n  const it = p7formItem(label);\n  if (!it) return null;\n  const el = it.querySelector('textarea, input');\n  return el ? el.value : null;\n};\nconst p7visibleInputs = () => Array.from(document.querySelectorAll('input, textarea'))\n  .filter((e) => !e.disabled && e.offsetParent !== null)\n  .map((e) => ({ tag: e.tagName, type: e.type, value: e.value, placeholder: e.placeholder || '' }));\nconst p7contrast = (fg, bg) => {\n  const lum = (rgb) => {\n    const m = String(rgb).match(/[0-9.]+/g);\n    if (!m || m.length < 3) return null;\n    const f = (c) => {\n      const v = Number(c) / 255;\n      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);\n    };\n    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);\n  };\n  const a = lum(fg);\n  const b = lum(bg);\n  if (a === null || b === null) return null;\n  const hi = Math.max(a, b);\n  const lo = Math.min(a, b);\n  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;\n};\nconst p7bgOf = (el) => {\n  let node = el;\n  while (node && node !== document.documentElement) {\n    const bg = getComputedStyle(node).backgroundColor;\n    const m = String(bg).match(/rgba?\\(([^)]+)\\)/);\n    if (m) {\n      const parts = m[1].split(',').map((s) => s.trim());\n      const alpha = parts.length >= 4 ? Number(parts[3]) : 1;\n      if (alpha > 0.05) return bg;\n    }\n    node = node.parentElement;\n  }\n  return getComputedStyle(document.body).backgroundColor;\n};\n"

/** 页面内密码学原语（与 src/team/identity.ts 完全一致的参数：ECDH P-256 + HKDF-SHA256 + AES-GCM） */
export const CRYPTO_LIB = "\nconst p7b64u = (u8) => {\n  let bin = '';\n  for (const b of u8) bin += String.fromCharCode(b);\n  return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');\n};\nconst p7unb64u = (s) => {\n  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));\n  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);\n  const out = new Uint8Array(bin.length);\n  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);\n  return out;\n};\nconst p7b64 = (u8) => {\n  let bin = '';\n  for (const b of u8) bin += String.fromCharCode(b);\n  return btoa(bin);\n};\nconst p7unb64 = (s) => {\n  const bin = atob(s);\n  const out = new Uint8Array(bin.length);\n  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);\n  return out;\n};\nconst p7genKeys = async () => {\n  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);\n  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));\n  return { priv: kp.privateKey, pub: p7b64u(raw) };\n};\nconst p7derive = async (priv, peerPubB64u, sessionId) => {\n  const raw = p7unb64u(peerPubB64u);\n  if (raw.length !== 65) throw new Error('主机公钥不是 65 字节');\n  const peer = await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);\n  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256));\n  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);\n  const bits = await crypto.subtle.deriveBits({\n    name: 'HKDF',\n    hash: 'SHA-256',\n    salt: new TextEncoder().encode('knapsack-team/1|' + sessionId),\n    info: new TextEncoder().encode('host<-client'),\n  }, ikm, 256);\n  return crypto.subtle.importKey('raw', new Uint8Array(bits), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);\n};\nconst p7seal = async (key, plain, aad) => {\n  const nonce = crypto.getRandomValues(new Uint8Array(12));\n  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(aad) }, key, plain));\n  const out = new Uint8Array(12 + ct.length);\n  out.set(nonce, 0);\n  out.set(ct, 12);\n  return out;\n};\nconst p7openSeal = async (key, msg, aad) => {\n  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: msg.subarray(0, 12), additionalData: new TextEncoder().encode(aad) }, key, msg.subarray(12));\n  return new Uint8Array(pt);\n};\nconst p7ticketParts = (ticketText) => {\n  const i = ticketText.indexOf('?');\n  if (i < 0) throw new Error('会话码缺少 ?');\n  const q = new URLSearchParams(ticketText.slice(i + 1));\n  return { ip: q.get('ip') || '', port: q.get('port') || '', sessionId: q.get('s') || '', teamId: q.get('t') || '', hostPub: q.get('p') || '' };\n};\nconst p7post = async (url, sealed) => {\n  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: sealed });\n  const text = await resp.text();\n  return { status: resp.status, ok: resp.ok, bodyText: text.slice(0, 300) };\n};\n"

/** 注入 fixture 数据（同主键行覆盖） */
export function injectExpr(payload: {
  teams?: unknown[]
  publications?: unknown[]
  outbox?: unknown[]
  idempotency?: unknown[]
  links?: unknown[]
}): string {
  return (
    '(async () => {' +
    PAGE_LIB +
    ' const db = await p7openDb();' +
    ' const counts = {};' +
    " counts.teamState = await p7putRows(db, 'teamState', " +
    JSON.stringify(payload.teams ?? []) +
    ');' +
    " counts.teamPublications = await p7putRows(db, 'teamPublications', " +
    JSON.stringify(payload.publications ?? []) +
    ');' +
    " counts.teamOutbox = await p7putRows(db, 'teamOutbox', " +
    JSON.stringify(payload.outbox ?? []) +
    ');' +
    " counts.teamIdempotency = await p7putRows(db, 'teamIdempotency', " +
    JSON.stringify(payload.idempotency ?? []) +
    ');' +
    " counts.teamLink = await p7putRows(db, 'teamLink', " +
    JSON.stringify(payload.links ?? []) +
    ');' +
    ' db.close();' +
    ' return JSON.stringify({ counts });' +
    ' })()'
  )
}

/** 读出 knapsack 库全部团队相关表 */
export const READ_STATE_EXPR =
  '(async () => {' +
  PAGE_LIB +
  ' const db = await p7openDb();' +
  ' const out = {' +
  " teams: await p7all(db, 'teamState')," +
  " publications: await p7all(db, 'teamPublications')," +
  " outbox: await p7all(db, 'teamOutbox')," +
  " idempotency: await p7all(db, 'teamIdempotency')," +
  " links: await p7all(db, 'teamLink')" +
  ' };' +
  ' db.close();' +
  ' return JSON.stringify(out);' +
  ' })()'

/** 扫描持久化存储里是否残留会话密钥类材料 */
export const SCAN_STORAGE_EXPR =
  '(async () => {' +
  PAGE_LIB +
  " const markers = ['sessionKey', 'hostPub', 'privateKey', 'knapsack-team/1?'];" +
  ' const hits = [];' +
  ' const scan = (where, key, value) => {' +
  " const s = typeof value === 'string' ? value : JSON.stringify(value === undefined ? null : value);" +
  ' for (const m of markers) if (s && s.indexOf(m) >= 0) hits.push({ where, key, marker: m });' +
  ' };' +
  ' for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); scan("localStorage", k, localStorage.getItem(k)); }' +
  ' for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); scan("sessionStorage", k, sessionStorage.getItem(k)); }' +
  ' const names = (indexedDB.databases ? await indexedDB.databases() : [{ name: "knapsack" }]).map((d) => d.name).filter(Boolean);' +
  ' const dbs = [];' +
  ' for (const name of names) {' +
  ' const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });' +
  ' for (const st of Array.from(db.objectStoreNames)) {' +
  ' const rows = await p7all(db, st);' +
  ' dbs.push({ db: name, store: st, rows: rows.length });' +
  ' for (const row of rows) scan("idb:" + name + "/" + st, (row && (row.teamId || row.publicationId || row.operationId || row.idempotencyKey || row.id)) || "?", row);' +
  ' }' +
  ' db.close();' +
  ' }' +
  ' return JSON.stringify({ localKeys: Object.keys(localStorage), sessionKeys: Object.keys(sessionStorage), dbs, hits });' +
  ' })()'

/** 让「复制会话码」把 ticket 交给脚本：拦截 navigator.clipboard.writeText */
export const CLIPBOARD_PATCH_EXPR =
  '(() => {' +
  ' window.__p7ticket = null;' +
  ' window.__p7clipErr = null;' +
  ' try {' +
  ' let cb = navigator.clipboard || null;' +
  ' if (!cb) { try { const stub = { writeText: async () => undefined, readText: async () => "" }; Object.defineProperty(navigator, "clipboard", { configurable: true, value: stub }); cb = stub; } catch (e) { window.__p7clipErr = "navigator.clipboard 不存在且无法注入: " + String(e); return JSON.stringify({ patched: false, err: window.__p7clipErr }); } }' +
  ' const orig = cb.writeText ? cb.writeText.bind(cb) : null;' +
  ' Object.defineProperty(cb, "writeText", { configurable: true, value: async (t) => { window.__p7ticket = String(t); if (orig) { try { return await orig(t); } catch (e) { return undefined; } } } });' +
  ' return JSON.stringify({ patched: true });' +
  ' } catch (e) { window.__p7clipErr = String(e); return JSON.stringify({ patched: false, err: String(e) }); }' +
  ' })()'

export const READ_TICKET_EXPR =
  '(() => JSON.stringify({ ticket: window.__p7ticket || null, err: window.__p7clipErr || null }))()'

/** 用会话码建立会话并发送一个动作，返回状态码与解密结果 */
export function handshakeExpr(opts: {
  ticket: string
  type: string
  payload: unknown
  operationId?: string
}): string {
  return (
    '(async () => {' +
    PAGE_LIB +
    CRYPTO_LIB +
    ' try {' +
    ' const ticket = ' +
    JSON.stringify(opts.ticket) +
    ';' +
    ' const parts = p7ticketParts(ticket);' +
    ' const kp = await p7genKeys();' +
    ' const key = await p7derive(kp.priv, parts.hostPub, parts.sessionId);' +
    " const aad = 'knapsack-team/1|' + parts.sessionId + '|POST|/action';" +
    ' const env = { protocol: "knapsack-team/1", schemaVersion: 1, teamId: parts.teamId, operationId: ' +
    JSON.stringify(opts.operationId ?? 'p7-probe') +
    ', type: ' +
    JSON.stringify(opts.type) +
    ', payload: ' +
    JSON.stringify(opts.payload) +
    ' };' +
    ' const sealed = await p7seal(key, new TextEncoder().encode(JSON.stringify(env)), aad);' +
    " const url = 'http://' + (parts.ip || '127.0.0.1') + ':' + parts.port + '/action?c=' + encodeURIComponent(kp.pub);" +
    ' const resp = await p7post(url, sealed);' +
    ' let decrypted = null;' +
    ' let decryptError = null;' +
    ' if (resp.ok) {' +
    ' try { decrypted = JSON.parse(new TextDecoder().decode(await p7openSeal(key, p7unb64(resp.bodyText.trim()), aad))); } catch (e) { decryptError = String(e); }' +
    ' }' +
    ' return JSON.stringify({ sessionId: parts.sessionId, teamId: parts.teamId, hostPub: parts.hostPub, clientPub: kp.pub, url, status: resp.status, ok: resp.ok, bodyText: resp.bodyText, decrypted, decryptError, sealedB64: p7b64(sealed) });' +
    ' } catch (e) { return JSON.stringify({ fatal: String(e) }); }' +
    ' })()'
  )
}

/** 把旧会话密文重放到当前会话地址（预期被拒） */
export function replayOldSealedExpr(opts: { url: string; sealedB64: string }): string {
  return (
    '(async () => {' +
    PAGE_LIB +
    CRYPTO_LIB +
    ' try {' +
    ' const sealed = p7unb64(' +
    JSON.stringify(opts.sealedB64) +
    ');' +
    ' const resp = await p7post(' +
    JSON.stringify(opts.url) +
    ', sealed);' +
    ' return JSON.stringify({ status: resp.status, ok: resp.ok, bodyText: resp.bodyText });' +
    ' } catch (e) { return JSON.stringify({ fatal: String(e) }); }' +
    ' })()'
  )
}

/** 读 /info（明文握手，用于确认当前会话 id） */
export function infoExpr(baseUrl: string): string {
  return (
    '(async () => { try { const r = await fetch(' +
    JSON.stringify(baseUrl + '/info') +
    ', { cache: "no-store" }); return JSON.stringify({ status: r.status, body: await r.text() }); } catch (e) { return JSON.stringify({ fatal: String(e) }); } })()'
  )
}

/** 从会话信息文本里解析端口（TeamPublishTab 用 <code>ip:port</code> 显示） */
export const READ_SESSION_PORT_EXPR =
  '(() => { const codes = Array.from(document.querySelectorAll("code")); const hit = codes.map((c) => (c.innerText || "").trim()).find((t) => /:[0-9]{2,5}$/.test(t));' +
  ' if (!hit) return JSON.stringify({ port: null, codes: codes.map((c) => c.innerText) });' +
  ' return JSON.stringify({ port: Number(hit.split(":").pop()), text: hit }); })()'

/** 主题：写 localStorage（App 启动时读取） */
export function setThemeExpr(mode: string): string {
  return '(() => { localStorage.setItem("knapsack.theme", ' + JSON.stringify(mode) + '); return JSON.stringify({ ok: true }); })()'
}

export const THEME_PROBE_EXPR =
  '(() => {' +
  PAGE_LIB +
  ' const main = document.querySelector(".app-main") || document.body;' +
  ' const fg = getComputedStyle(document.body).color;' +
  ' const bg = p7bgOf(main);' +
  ' return JSON.stringify({ dataTheme: document.documentElement.dataset.theme || null, fg, bg, contrast: p7contrast(fg, bg) });' +
  ' })()'

/** 布局探针（小屏判定） */
export const LAYOUT_PROBE_EXPR =
  '(() => {' +
  PAGE_LIB +
  ' const side = document.querySelector(".app-sidebar");' +
  ' const shell = document.querySelector(".app-shell");' +
  ' return JSON.stringify({' +
  ' innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio,' +
  ' narrow: window.matchMedia("(max-width: 720px)").matches,' +
  ' sidebarFlexDirection: side ? getComputedStyle(side).flexDirection : null,' +
  ' shellFlexDirection: shell ? getComputedStyle(shell).flexDirection : null,' +
  ' scrollWidth: document.documentElement.scrollWidth,' +
  ' clientWidth: document.documentElement.clientWidth' +
  ' });' +
  ' })()'

/** 创建并返回一个 <input type=file> 供 CDP DOM.setFileInputFiles 使用 */
export const ENSURE_FILE_INPUT_EXPR =
  '(() => {' +
  ' let el = document.getElementById("p7-file-input");' +
  ' if (!el) { el = document.createElement("input"); el.type = "file"; el.id = "p7-file-input"; el.style.position = "fixed"; el.style.left = "-9999px"; document.body.appendChild(el); }' +
  ' return JSON.stringify({ ok: !!el });' +
  ' })()'

/** 读取 file input 里的文件内容（与 pickTextFile 相同的 File API 路径） */
export const READ_FILE_INPUT_EXPR =
  '(async () => {' +
  ' try {' +
  ' const el = document.getElementById("p7-file-input");' +
  ' if (!el || !el.files || el.files.length === 0) return JSON.stringify({ fatal: "input 没有文件" });' +
  ' const f = el.files[0];' +
  ' const text = await f.text();' +
  ' return JSON.stringify({ name: f.name, size: f.size, text });' +
  ' } catch (e) { return JSON.stringify({ fatal: String(e) }); }' +
  ' })()'

/** 用 Capacitor Filesystem 写文件，返回 uri */
export function writeFileExpr(path: string, text: string, directory = 'CACHE'): string {
  return (
    '(async () => { try {' +
    ' const F = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;' +
    ' if (!F) return JSON.stringify({ fatal: "Filesystem 插件不可见" });' +
    ' const res = await F.writeFile({ path: ' +
    JSON.stringify(path) +
    ', data: ' +
    JSON.stringify(text) +
    ', directory: ' +
    JSON.stringify(directory) +
    ', encoding: "utf8", recursive: true });' +
    ' return JSON.stringify({ uri: res.uri }); } catch (e) { return JSON.stringify({ fatal: String(e) }); } })()'
  )
}

export const SHARE_CAN_EXPR =
  '(async () => { try {' +
  ' const S = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;' +
  ' if (!S) return JSON.stringify({ fatal: "Share 插件不可见" });' +
  ' const r = await S.canShare(); return JSON.stringify({ canShare: r.value === true });' +
  ' } catch (e) { return JSON.stringify({ fatal: String(e) }); } })()'

/** 读取当前所有 naive-ui 消息条文本（判断成功/错误提示用） */
export const TOASTS_EXPR = '(function () {' + PAGE_LIB + ' return JSON.stringify(p7toasts()); })()'

/** 删除指定 teamId 的全部团队相关行（让每项验收都从干净 fixture 开始） */
export function resetTeamsExpr(teamIds: string[]): string {
  return (
    '(async () => {' +
    PAGE_LIB +
    ' const ids = ' +
    JSON.stringify(teamIds) +
    ';' +
    ' const db = await p7openDb();' +
    ' const stores = ["teamState", "teamPublications", "teamOutbox", "teamIdempotency", "teamLink"];' +
    ' const deleted = {};' +
    ' for (const st of stores) {' +
    ' deleted[st] = await new Promise((res, rej) => {' +
    ' const tx = db.transaction([st], "readwrite");' +
    ' const os = tx.objectStore(st);' +
    ' let n = 0;' +
    ' const rq = os.openCursor();' +
    ' rq.onsuccess = () => { const cur = rq.result; if (!cur) return; const v = cur.value || {};' +
    // teamPublications 行的 teamId 在 meta 里（row = {publicationId, meta, snapshot}），其余 store 是顶层 teamId
    ' const tid = v.teamId || (v.meta && v.meta.teamId);' +
    ' if (ids.indexOf(tid) >= 0) { cur.delete(); n++; } cur.continue(); };' +
    ' rq.onerror = () => rej(rq.error);' +
    ' tx.oncomplete = () => res(n);' +
    ' tx.onerror = () => rej(tx.error);' +
    ' });' +
    ' }' +
    ' db.close();' +
    ' return JSON.stringify({ deleted });' +
    ' })()'
  )
}
