import { db } from '../../../db'
import { DexiePromptRepository } from './dexieRepository'
import { projectWorkPrompts } from './workPromptCatalog'
import type { WorkPromptProjection } from '../../../core/capabilityContracts'

/** capability 入口：供 manifest 异步加载；提示词库关闭时不会被调用，query 返回空数组 */
export async function listWorkPromptsForCatalog(): Promise<WorkPromptProjection[]> {
  const repository = new DexiePromptRepository(db)
  const items = await repository.listItems()
  return projectWorkPrompts(items)
}
