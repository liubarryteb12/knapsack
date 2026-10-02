/**
 * 局域网会话 · 主机端封装（阶段12）
 *
 * 只有 Tauri 桌面版能当主机（Capacitor 侧没有内嵌 HTTP 服务）。
 * 这里是对 Rust 侧 `session_*` 命令的薄封装，并用 `isTauri()` 把
 * 「不在桌面端」这件事显式暴露给界面。
 */
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface HostSessionInfo {
  ip: string
  port: number
  /** base64url 的 32 字节会话密钥，只应出现在二维码里 */
  keyB64: string
  sessionId: string
  tripId: string
  tripName: string
  /** 本机所有可用局域网地址；多网卡（含代理 TUN）时前端可让用户切换 */
  ipCandidates: string[]
}

export interface HostSessionStatus {
  running: boolean
  info: HostSessionInfo | null
  lastPushAt: number | null
  lastPullAt: number | null
}

/** 当前运行环境能不能当主机 */
export function canHost(): boolean {
  return isTauri()
}

export async function startSession(trip: unknown): Promise<HostSessionInfo> {
  return await invoke<HostSessionInfo>('session_start', { trip })
}

export async function stopSession(): Promise<void> {
  await invoke('session_stop')
}

export async function getSessionStatus(): Promise<HostSessionStatus> {
  return await invoke<HostSessionStatus>('session_status')
}

/** 主机本地改动后把最新副本推给服务端，保证接入方拉到的不是旧版 */
export async function updateSessionTrip(trip: unknown): Promise<void> {
  await invoke('session_update_trip', { trip })
}

/** 订阅「接入方推来了一份行程」 */
export async function onSessionPushed(cb: (trip: unknown) => void): Promise<UnlistenFn> {
  return await listen<unknown>('session://pushed', (e) => cb(e.payload))
}
