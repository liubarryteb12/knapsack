import {
  promptItemSchema,
  promptMediaSchema,
  promptSnippetSchema,
  type PromptItem,
  type PromptMediaRecord,
  type PromptSnippet,
} from '../schema'
import type { PromptRepository } from './repository'

export class InMemoryPromptRepository implements PromptRepository {
  private readonly items = new Map<string, PromptItem>()
  private readonly snippets = new Map<string, PromptSnippet>()
  private readonly media = new Map<string, PromptMediaRecord>()

  async listItems(): Promise<PromptItem[]> {
    return [...this.items.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getItem(id: string): Promise<PromptItem | null> {
    return this.items.get(id) ?? null
  }

  async putItem(item: PromptItem): Promise<void> {
    this.items.set(item.id, promptItemSchema.parse(item))
  }

  async deleteItem(id: string): Promise<void> {
    this.items.delete(id)
    for (const [key, media] of this.media) {
      if (media.itemId === id) this.media.delete(key)
    }
  }

  async listSnippets(): Promise<PromptSnippet[]> {
    return [...this.snippets.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async putSnippet(snippet: PromptSnippet): Promise<void> {
    this.snippets.set(snippet.id, promptSnippetSchema.parse(snippet))
  }

  async deleteSnippet(id: string): Promise<void> {
    this.snippets.delete(id)
  }

  async getMedia(mediaId: string): Promise<PromptMediaRecord | null> {
    return this.media.get(mediaId) ?? null
  }

  async listMediaByItem(itemId: string): Promise<PromptMediaRecord[]> {
    return [...this.media.values()].filter((media) => media.itemId === itemId)
  }

  async putMedia(media: PromptMediaRecord): Promise<void> {
    this.media.set(media.mediaId, promptMediaSchema.parse(media))
  }

  async deleteMedia(mediaId: string): Promise<void> {
    this.media.delete(mediaId)
  }

  async clearAll(): Promise<void> {
    this.items.clear()
    this.snippets.clear()
    this.media.clear()
  }
}
