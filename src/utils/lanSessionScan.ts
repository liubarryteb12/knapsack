/**
 * 局域网会话 · 扫码能力探测（阶段12）
 *
 * 用纯 JS 的 html5-qrcode（getUserMedia），不引原生扫码 SDK——
 * 原生方案会把 Compose + MLKit 拖进来，APK 从 4.6MB 涨到 34MB，
 * 与本项目「轻量」的核心气质冲突。
 */
import { Capacitor } from '@capacitor/core'

/** 当前环境能不能开摄像头扫码 */
export function canScan(): boolean {
  const hasCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  return hasCamera && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

/** getUserMedia 需要安全上下文；Capacitor 的 https://localhost 满足 */
export function scanUnavailableReason(): string {
  if (!Capacitor.isNativePlatform()) return '只有手机端能扫码，桌面端请用「复制会话码」'
  if (!navigator.mediaDevices?.getUserMedia) return '当前环境不支持调用摄像头'
  return ''
}
