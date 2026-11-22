/**
 * 文件桥（P6，A34）：把「保存 / 分享 / 选择」收敛成平台感知的一次调用。
 * - 桌面（Tauri）：弹系统「另存为」对话框，用户自己选位置，再原生写盘
 * - Android：写入应用缓存目录后弹系统分享面板，用户可存到「文件」或发给别人；真正的系统往返
 * - Web：浏览器下载 + <input type="file"> 选择
 * 本模块只负责搬运字节，不解释格式；序列化/校验由 teamFile.ts 负责。
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'

export interface SaveFileResult {
  ok: boolean
  /** 用户在保存对话框里取消 */
  cancelled?: boolean
  /** 落盘路径（桌面端选中的路径 / Android 的 file:// 地址） */
  uri?: string
  /** 写入成功但分享面板失败等非致命问题 */
  warning?: string
  error?: string
}

export type PickTextFileResult =
  | { name: string; text: string }
  | { error: string }
  | null

/** 触发浏览器下载（web 兜底） */
export function downloadTextFile(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 保存文本文件。
 * 桌面端：系统「另存为」对话框选路径后写盘；取消返回 cancelled。
 * 原生移动端：写缓存目录 + 系统分享（分享被取消不算失败）。
 * web 端：浏览器下载。
 */
export async function saveTextFile(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveFileResult> {
  if (isTauri()) {
    return saveWithDialog(filename, new TextEncoder().encode(text))
  }

  if (Capacitor.isNativePlatform()) {
    let uri: string
    try {
      const res = await Filesystem.writeFile({
        path: filename,
        data: text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      })
      uri = res.uri
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    try {
      await Share.share({ title: filename, url: uri, dialogTitle: '保存或分享' })
      return { ok: true, uri }
    } catch (e) {
      // 文件已落盘，仅分享面板未完成；调用方据此提示「已保存到应用缓存」
      return { ok: true, uri, warning: e instanceof Error ? e.message : String(e) }
    }
  }

  try {
    downloadTextFile(filename, text, mime)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 保存二进制文件（图片等）。原生端同样走「写缓存 + 系统分享」，web 端走浏览器下载。
 */
export async function saveBinaryFile(
  filename: string,
  data: Blob,
  _mime = 'application/octet-stream',
): Promise<SaveFileResult> {
  if (isTauri()) {
    return saveWithDialog(filename, new Uint8Array(await data.arrayBuffer()))
  }

  if (Capacitor.isNativePlatform()) {
    let uri: string
    try {
      const base64 = await blobToBase64(data)
      const res = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      })
      uri = res.uri
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    try {
      await Share.share({ title: filename, url: uri, dialogTitle: '保存或分享' })
      return { ok: true, uri }
    } catch (e) {
      return { ok: true, uri, warning: e instanceof Error ? e.message : String(e) }
    }
  }

  try {
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    // 立即 revoke 会让部分浏览器取消下载，延后释放
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 常见扩展名 → 另存为对话框里的过滤器名称 */
const EXT_LABEL: Record<string, string> = {
  png: 'PNG 图片',
  svg: 'SVG 矢量图',
  md: 'Markdown',
  opml: 'OPML 大纲',
  json: 'JSON 文件',
  trip: '行程文件',
  team_public: '团队包（公开）',
  team_submit: '团队包（提交）',
}

/**
 * 桌面端保存：先弹系统「另存为」让用户自己选位置，再交给 Rust 命令写盘。
 * 用户取消返回 cancelled，调用方据此静默处理。
 */
async function saveWithDialog(filename: string, bytes: Uint8Array): Promise<SaveFileResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  try {
    const path = await save({
      title: '保存到',
      defaultPath: filename,
      filters: ext ? [{ name: EXT_LABEL[ext] ?? ext.toUpperCase(), extensions: [ext] }] : undefined,
    })
    if (!path) return { ok: false, cancelled: true }
    await invoke('save_file_bytes', { path, contentsBase64: bytesToBase64(bytes) })
    return { ok: true, uri: path }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Uint8Array → 纯 base64，分块避免超长参数栈溢出。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Blob → 纯 base64（去掉 dataURL 前缀），供 Filesystem.writeFile 使用。 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('读取二进制失败'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取二进制失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 选择文本文件。用户取消返回 null。
 * 用 <input type="file">：Capacitor Android WebView 已实现系统文件选择器，原生可用。
 */export function pickTextFile(
  accept = '.team-public,.team-submit,application/json',
): Promise<PickTextFileResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const finish = (v: PickTextFileResult) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(v)
    }
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        finish(null)
        return
      }
      try {
        finish({ name: file.name, text: await file.text() })
      } catch (e) {
        finish({ error: `读取文件失败：${e instanceof Error ? e.message : String(e)}` })
      }
    }
    // 现代 WebView 支持 cancel 事件；不支持时靠下一次选择覆盖
    input.oncancel = () => finish(null)
    document.body.appendChild(input)
    input.click()
  })
}
