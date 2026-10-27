import type { KnapsackDB } from '../../../db'
import {
  promptItemSchema,
  promptMediaSchema,
  promptSnippetSchema,
  type PromptItem,
  type PromptMediaRecord,
  type PromptSnippet,
} from '../schema'
import type { PromptRepository } from './repository'

export class DexiePromptRepository implements PromptRepository {
  constructor(private readonly db: KnapsackDB) {}

  private items() {
    return this.db.table<PromptItem, string>('mod_prompts_items')
  }

  private snippets() {
    return this.db.table<PromptSnippet, string>('mod_prompts_snippets')
  }

  private media() {
    return this.db.table<PromptMediaRecord, string>('mod_prompts_media')
  }

  async listItems(): Promise<PromptItem[]> {
    const rows = await this.items().orderBy('updatedAt').reverse().toArray()
    return rows.flatMap((row) => {
      const parsed = promptItemSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
  }

  async getItem(id: string): Promise<PromptItem | null> {
    const row = await this.items().get(id)
    return row ? promptItemSchema.parse(row) : null
  }

  async putItem(item: PromptItem): Promise<void> {
    await this.items().put(promptItemSchema.parse(item))
  }

  async deleteItem(id: string): Promise<void> {
    await this.db.transaction('rw', this.items(), this.media(), async () => {
      const mediaIds = await this.media().where('itemId').equals(id).primaryKeys()
      if (mediaIds.length > 0) await this.media().bulkDelete(mediaIds)
      await this.items().delete(id)
    })
  }

  async listSnippets(): Promise<PromptSnippet[]> {
    const rows = await this.snippets().orderBy('updatedAt').reverse().toArray()
    return rows.flatMap((row) => {
      const parsed = promptSnippetSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
  }

  async putSnippet(snippet: PromptSnippet): Promise<void> {
    await this.snippets().put(promptSnippetSchema.parse(snippet))
  }

  async deleteSnippet(id: string): Promise<void> {
    await this.snippets().delete(id)
  }

  async getMedia(mediaId: string): Promise<PromptMediaRecord | null> {
    const row = await this.media().get(mediaId)
    return row ? promptMediaSchema.parse(row) : null
  }

  async listMediaByItem(itemId: string): Promise<PromptMediaRecord[]> {
    const rows = await this.media().where('itemId').equals(itemId).toArray()
    return rows.flatMap((row) => {
      const parsed = promptMediaSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
  }

  async putMedia(media: PromptMediaRecord): Promise<void> {
    await this.media().put(promptMediaSchema.parse(media))
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.media().delete(mediaId)
  }

  async clearAll(): Promise<void> {
    await this.db.transaction('rw', this.items(), this.snippets(), this.media(), async () => {
      await Promise.all([this.items().clear(), this.snippets().clear(), this.media().clear()])
    })
  }
}
