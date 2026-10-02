/**
 * 局域网会话 · 扫码（阶段12）
 *
 * 只有 Capacitor 原生端（安卓）能调系统相机；浏览器/桌面端不支持。
 * 动态 import，避免把安卓插件打进桌面与 Web 包。
 */
import { Capacitor } from '@capacitor/core'

/** 当前环境能不能扫码 */
export function canScan(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

/** 打开相机扫二维码，返回原始文本；用户取消时抛错 */
export async function scanJoinCode(): Promise<string> {
  const mod = await import('@capacitor/barcode-scanner')
  const res = await mod.CapacitorBarcodeScanner.scanBarcode({
    hint: mod.CapacitorBarcodeScannerTypeHint.QR_CODE,
    scanInstructions: '对准主机屏幕上的二维码',
    scanButton: false,
    cameraDirection: mod.CapacitorBarcodeScannerCameraDirection.BACK,
  })
  const text = res?.ScanResult ?? ''
  if (!text) throw new Error('没有扫到内容')
  return text
}
