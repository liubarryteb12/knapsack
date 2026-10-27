import type { PromptItem, PromptMediaRecord, PromptSnippet } from '../schema'

/** Deep repository seam used by the Pinia store and in-memory tests. */
export interface PromptRepository {
  listItems(): Promise<PromptItem[]>
  getItem(id: string): Promise<PromptItem | null>
  putItem(item: PromptItem): Promise<void>
  deleteItem(id: string): Promise<void>

  listSnippets(): Promise<PromptSnippet[]>
  putSnippet(snippet: PromptSnippet): Promise<void>
  deleteSnippet(id: string): Promise<void>

  getMedia(mediaId: string): Promise<PromptMediaRecord | null>
  listMediaByItem(itemId: string): Promise<PromptMediaRecord[]>
  putMedia(media: PromptMediaRecord): Promise<void>
  deleteMedia(mediaId: string): Promise<void>

  clearAll(): Promise<void>
}
