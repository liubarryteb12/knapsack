/**
 * 文件桥（P6，A34）：把「保存 / 分享 / 选择」收敛成平台感知的一次调用。
 * - Android：写入应用缓存目录后弹系统分享面板，用户可存到「文件」或发给别人；真正的系统往返
 * - Web/桌面：浏览器下载 + <input type="file"> 选择
 * 本模块只负责搬运字节，不解释格式；序列化/校验由 teamFile.ts 负责。
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export interface SaveFileResult {
  ok: boolean
  /** 原生写入后的 file:// 地址（web 端没有） */
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
 * 原生端：写缓存目录 + 系统分享（用户真正能拿到文件）；分享被取消不算失败。
 * web 端：浏览器下载。
 */
export async function saveTextFile(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveFileResult> {
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
 * 选择文本文件。用户取消返回 null。
 * 用 <input type="file">：Capacitor Android WebView 已实现系统文件选择器，原生可用。
 */
export function pickTextFile(
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
