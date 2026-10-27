/**
 * P7 单机真机验收 · CDP 驱动（adb forward tcp:9222 → /json/list → WebSocket Runtime.evaluate）
 *
 * 沿用 scripts/p0-device-check.ts、p6-device-file.ts 的驱动模式，补上：
 * - 每次连接前清理残留转发（避免上一个脚本中断后 9222 被占用）
 * - 目标页等待、应用就绪等待、文本/元素点击、超时控制
 * - 页面脚本统一返回 JSON 字符串，Node 侧解析，避免 CDP 序列化差异
 */
import { sleep, forwardCdp, clearCdpForward } from './p7-adb'

export interface CdpTarget {
  id: string
  url: string
  webSocketDebuggerUrl: string
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export async function waitForTarget(timeoutMs = 30_000): Promise<CdpTarget> {
  const deadline = Date.now() + timeoutMs
  let last = '未拿到 /json/list'
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(3000) })
      const list = (await res.json()) as CdpTarget[]
      const page = list.find((t) => (t.url || '').includes('localhost'))
      if (page) return page
      last = '/json/list 中没有 localhost 页面，当前：' + JSON.stringify(list.map((t) => t.url))
    } catch (e) {
      last = '请求 /json/list 失败：' + (e instanceof Error ? e.message : String(e))
    }
    await sleep(400)
  }
  throw new Error('等待 WebView CDP 目标超时：' + last)
}

export class Cdp {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, Pending>()
  readonly target: CdpTarget
  readonly socket: string

  private listeners = new Map<string, Array<(params: Record<string, unknown>) => void>>()
  private closeHandlers: Array<(reason: string) => void> = []
  /** 非 null 表示连接已断（渲染进程崩溃/页面销毁时 WebSocket 会断开） */
  closedReason: string | null = null

  private constructor(ws: WebSocket, target: CdpTarget, socket: string) {
    this.ws = ws
    this.target = target
    this.socket = socket
    this.ws.addEventListener('message', (ev: MessageEvent) => this.onMessage(ev))
    this.ws.addEventListener('close', () => this.markClosed('WebSocket closed（渲染进程可能已崩溃）'))
    this.ws.addEventListener('error', () => this.markClosed('WebSocket error'))
  }

  private markClosed(reason: string): void {
    if (this.closedReason) return
    this.closedReason = reason
    for (const fn of this.closeHandlers) {
      try {
        fn(reason)
      } catch {
        /* ignore */
      }
    }
  }

  /** 订阅 CDP 事件（如 Runtime.exceptionThrown / Log.entryAdded / Page.javascriptDialogOpening） */
  on(method: string, fn: (params: Record<string, unknown>) => void): void {
    const arr = this.listeners.get(method) ?? []
    arr.push(fn)
    this.listeners.set(method, arr)
  }

  /** 连接断开回调（崩溃取证用） */
  onClose(fn: (reason: string) => void): void {
    if (this.closedReason) {
      fn(this.closedReason)
      return
    }
    this.closeHandlers.push(fn)
  }

  get isOpen(): boolean {
    return this.closedReason === null && this.ws.readyState === 1
  }

  static async attach(opts: { timeoutMs?: number; waitApp?: boolean } = {}): Promise<Cdp> {
    const { socket } = forwardCdp()
    const target = await waitForTarget(opts.timeoutMs ?? 30_000)
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), 15_000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('CDP WebSocket 连接失败'))
      })
    })
    const cdp = new Cdp(ws, target, socket)
    await cdp.send('Runtime.enable').catch(() => undefined)
    if (opts.waitApp !== false) await cdp.waitForApp()
    return cdp
  }

  private onMessage(ev: MessageEvent): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(String(ev.data)) as typeof msg
    } catch {
      return
    }
    if (typeof msg.id !== 'number') {
      const method = (msg as { method?: string }).method
      if (typeof method === 'string') {
        const fns = this.listeners.get(method)
        if (fns) {
          const params = ((msg as { params?: Record<string, unknown> }).params ?? {}) as Record<string, unknown>
          for (const fn of fns) {
            try {
              fn(params)
            } catch {
              /* ignore */
            }
          }
        }
      }
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) {
      p.reject(new Error('CDP 错误：' + (msg.error.message ?? JSON.stringify(msg.error))))
      return
    }
    p.resolve(msg.result)
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('CDP ' + method + ' 超时(' + timeoutMs + 'ms)'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** 执行页面表达式，返回原始值（简单类型） */
  async evalRaw(expression: string, opts: { userGesture?: boolean; timeoutMs?: number } = {}): Promise<unknown> {
    const res = await this.send<{
      result?: { value?: unknown }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: opts.userGesture === true },
      opts.timeoutMs ?? 60_000,
    )
    if (res.exceptionDetails) {
      throw new Error(
        '页面执行异常：' +
          (res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? '未知异常'),
      )
    }
    return res.result?.value
  }

  /** 执行页面表达式并要求返回 JSON 字符串，Node 侧解析 */
  async evalJson<T>(expression: string, opts: { timeoutMs?: number } = {}): Promise<T> {
    const raw = await this.evalRaw(expression, opts)
    if (typeof raw !== 'string') throw new Error('页面脚本未返回 JSON 字符串：' + typeof raw)
    return JSON.parse(raw) as T
  }

  async waitFor(expression: string, timeoutMs = 15_000, intervalMs = 250): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        if ((await this.evalRaw(expression)) === true) return true
      } catch {
        // 页面可能正在重载，忽略并重试
      }
      await sleep(intervalMs)
    }
    return false
  }

  async waitForApp(timeoutMs = 40_000): Promise<void> {
    const ok = await this.waitFor(
      "document.readyState === 'complete' && !!document.querySelector('.app-shell')",
      timeoutMs,
      300,
    )
    if (!ok) throw new Error('等待应用 UI 就绪超时（.app-shell 未出现）')
  }

  async text(): Promise<string> {
    const v = await this.evalRaw('document.body ? document.body.innerText : ""')
    return typeof v === 'string' ? v : ''
  }

  async waitForText(text: string, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const t = await this.text().catch(() => '')
      if (t.includes(text)) return true
      await sleep(300)
    }
    return false
  }

  async waitForTextGone(text: string, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const t = await this.text().catch(() => '')
      if (!t.includes(text)) return true
      await sleep(300)
    }
    return false
  }

  /** 按精确文本点击按钮/标签页/链接 */
  async clickText(text: string, opts: { timeoutMs?: number } = {}): Promise<boolean> {
    const expr =
      "(() => { const want = " + JSON.stringify(text) +
      "; const els = Array.from(document.querySelectorAll('button, a, .n-button, .n-tabs-tab, .n-dropdown-option, [role=\"button\"], [role=\"menuitem\"]'));" +
      " const hit = els.find((e) => ((e.innerText || e.textContent || '').trim()) === want);" +
      " if (!hit) return false; hit.click(); return true; })()"
    const deadline = Date.now() + (opts.timeoutMs ?? 8000)
    while (Date.now() < deadline) {
      const ok = await this.evalRaw(expr, { userGesture: true }).catch(() => false)
      if (ok === true) return true
      await sleep(250)
    }
    return false
  }

  /** 按正则匹配文本点击（用于「发布第 N 版」这类带数字的按钮） */
  async clickMatch(pattern: string, opts: { timeoutMs?: number } = {}): Promise<boolean> {
    const expr =
      "(() => { const re = new RegExp(" + JSON.stringify(pattern) + ");" +
      " const els = Array.from(document.querySelectorAll('button, a, .n-button, .n-tabs-tab, .n-dropdown-option, [role=\"button\"], [role=\"menuitem\"]'));" +
      " const hit = els.find((e) => re.test(((e.innerText || e.textContent || '').trim())));" +
      " if (!hit) return false; hit.click(); return true; })()"
    const deadline = Date.now() + (opts.timeoutMs ?? 8000)
    while (Date.now() < deadline) {
      const ok = await this.evalRaw(expr, { userGesture: true }).catch(() => false)
      if (ok === true) return true
      await sleep(250)
    }
    return false
  }

  async countMatch(pattern: string): Promise<number> {
    const expr =
      "(() => { const re = new RegExp(" + JSON.stringify(pattern) + ");" +
      " const els = Array.from(document.querySelectorAll('button, a, .n-button, .n-tabs-tab, [role=\"button\"]'));" +
      " return els.filter((e) => re.test(((e.innerText || e.textContent || '').trim()))).length; })()"
    const v = await this.evalRaw(expr)
    return typeof v === 'number' ? v : 0
  }

  /** 切换 hash 路由并等待应用就绪 */
  async goto(hash: string, settleMs = 900): Promise<void> {
    await this.evalRaw('location.hash = ' + JSON.stringify(hash))
    await sleep(settleMs)
    await this.waitForApp()
    await sleep(300)
  }

  async reload(settleMs = 1500): Promise<void> {
    await this.evalRaw('location.reload()').catch(() => undefined)
    await sleep(settleMs)
    await this.waitForApp()
  }

  async screenshotBase64(): Promise<string> {
    await this.send('Page.enable').catch(() => undefined)
    const res = await this.send<{ data?: string }>('Page.captureScreenshot', { format: 'png' })
    return res.data ?? ''
  }

  async setDeviceMetrics(metrics: { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean } | null): Promise<void> {
    if (!metrics) {
      await this.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
      return
    }
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: metrics.width,
      height: metrics.height,
      deviceScaleFactor: metrics.deviceScaleFactor ?? 3,
      mobile: metrics.mobile !== false,
    })
  }

  async setColorScheme(scheme: 'light' | 'dark' | null): Promise<void> {
    if (!scheme) {
      await this.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined)
      return
    }
    await this.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    })
  }

  async setOffline(offline: boolean): Promise<void> {
    await this.send('Network.enable').catch(() => undefined)
    if (offline) {
      await this.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      })
    } else {
      await this.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
    }
  }

  /** 给 <input type=file> 设置设备侧文件（用于不经过系统选择器的文件读取路径） */
  async setFileInput(selector: string, devicePaths: string[]): Promise<boolean> {
    const doc = await this.send<{ root?: { nodeId?: number } }>('DOM.getDocument', { depth: -1 })
    const rootId = doc.root?.nodeId
    if (!rootId) return false
    const q = await this.send<{ nodeId?: number }>('DOM.querySelector', { nodeId: rootId, selector })
    const nodeId = q.nodeId
    if (!nodeId) return false
    await this.send('DOM.setFileInputFiles', { files: devicePaths, nodeId })
    return true
  }

  close(): void {
    try {
      this.ws.close()
    } catch {
      // 忽略关闭错误
    }
    clearCdpForward()
  }
}
