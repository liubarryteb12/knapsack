import type { ModId } from './modRegistry'

export type CapabilityTopic = `capability:${string}`
export type CapabilityProvider = (...args: any[]) => unknown | Promise<unknown>

interface Registration {
  modId: ModId
  provider: CapabilityProvider
}

export interface CapabilityFailure {
  topic: CapabilityTopic
  modId: ModId
  error: unknown
}

export interface CapabilityQueryResult<T> {
  values: T[]
  failures: CapabilityFailure[]
}

/**
 * Read-only cross-module capability exchange.
 *
 * Missing or disabled providers deliberately resolve to [] so callers can hide
 * their slot without branching on another module's installation state.
 */
export class CapabilityBus {
  private readonly providers = new Map<CapabilityTopic, Registration[]>()

  register(
    modId: ModId,
    capabilities: Partial<Record<CapabilityTopic, CapabilityProvider>> | undefined,
  ): void {
    this.unregister(modId)
    if (!capabilities) return
    for (const [topic, provider] of Object.entries(capabilities)) {
      if (!provider) continue
      const list = this.providers.get(topic as CapabilityTopic) ?? []
      list.push({ modId, provider })
      this.providers.set(topic as CapabilityTopic, list)
    }
  }

  unregister(modId: ModId): void {
    for (const [topic, list] of this.providers) {
      const remaining = list.filter((entry) => entry.modId !== modId)
      if (remaining.length === 0) this.providers.delete(topic)
      else this.providers.set(topic, remaining)
    }
  }

  has(topic: CapabilityTopic): boolean {
    return (this.providers.get(topic)?.length ?? 0) > 0
  }

  providersOf(topic: CapabilityTopic): readonly ModId[] {
    return (this.providers.get(topic) ?? []).map((entry) => entry.modId)
  }

  async queryDetailed<T = unknown>(
    topic: CapabilityTopic,
    ...args: unknown[]
  ): Promise<CapabilityQueryResult<T>> {
    const list = this.providers.get(topic) ?? []
    const failures: CapabilityFailure[] = []
    const results = await Promise.all(
      list.map(async ({ modId, provider }) => {
        try {
          return { value: await provider(...args) as T }
        } catch (error) {
          // A broken optional provider must not take down the host or other modules.
          const issues = error && typeof error === 'object' && 'issues' in error
            ? (error as { issues?: unknown }).issues
            : undefined
          console.warn(`[capability] provider failed: ${topic}`, issues ?? error)
          failures.push({ topic, modId, error })
          return null
        }
      }),
    )
    const values = results
      .filter((result): result is { value: T } => result !== null)
      .map((result) => result.value)
      .filter((value): value is T => value !== undefined && value !== null)
    return { values, failures }
  }

  async query<T = unknown>(topic: CapabilityTopic, ...args: unknown[]): Promise<T[]> {
    return (await this.queryDetailed<T>(topic, ...args)).values
  }
}
