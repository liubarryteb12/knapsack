/**
 * TeamHost 插件 · JS 侧封装（Android 主机）
 *
 * 契约（与 TeamHostPlugin.java 严格一致）：
 * - start({ sessionId, port? }) → { running, port, ... }
 * - stop() / status() / lanIps()
 * - addListener('teamRequest', handler)：handler 收到
 *   { requestId, path（含 query）, route, method, sessionId, bodyB64 }
 *   落库事务成功后必须 completeRequest({ requestId, ok, body })；
 *   不调用 → 原生 20s 后 504。事件发出 ≠ 成功。
 */
import { registerPlugin } from '@capacitor/core'

export interface TeamHostPluginInterface {
  start(options: { sessionId: string; port?: number }): Promise<{ running: boolean; port: number; sessionId: string; pending: number }>
  stop(): Promise<void>
  status(): Promise<{ running: boolean; sessionId: string | null; port: number; pending: number }>
  lanIps(): Promise<{ ips: string[] }>
  completeRequest(options: { requestId: string; ok: boolean; body: string }): Promise<void>
  addListener(eventName: 'teamRequest', cb: (evt: TeamRequestEvent) => void): Promise<PluginListenerHandleLike>
  removeAllListeners(): Promise<void>
}

export interface PluginListenerHandleLike {
  remove: () => Promise<void>
}

export interface TeamRequestEvent {
  requestId: string
  /** 完整路径（含 query），成员公钥等公开参数在 query 里 */
  path: string
  /** 去掉 query 的路由，用于匹配 /info、/action */
  route: string
  method: string
  sessionId: string
  /** 请求体 base64（原始密文字节）；JS 负责解密与校验 */
  bodyB64: string
}

export const TeamHost = registerPlugin<TeamHostPluginInterface>('TeamHost')

/** 当前环境是否有原生 TeamHost（Android；浏览器/桌面为 false） */
export function hasNativeTeamHost(): boolean {
  return typeof (window as unknown as Record<string, unknown>).Capacitor !== 'undefined'
    && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}
