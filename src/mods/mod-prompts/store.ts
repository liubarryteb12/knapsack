import { defineStore } from 'pinia'
import { db } from '../../db'
import { promptItemSchema, promptSnippetSchema, type PromptItem, type PromptMediaRecord, type PromptSnippet } from './schema'
import { DexiePromptRepository } from './services/dexieRepository'
import type { PromptRepository } from './services/repository'

function sortItems(items: PromptItem[]): PromptItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
}

function summaryOf(item: PromptItem): string {
  return `${item.title} · ${item.modality}`
}

export function createPromptsStore(repository: PromptRepository, storeId = 'prompts') {
  return defineStore(storeId, {
    state: () => ({
      items: [] as PromptItem[],
      snippets: [] as PromptSnippet[],
      loading: false,
      saving: false,
      error: '',
    }),

    actions: {
      async load(): Promise<void> {
        this.loading = true
        this.error = ''
        try {
          const [items, snippets] = await Promise.all([
            repository.listItems(),
            repository.listSnippets(),
          ])
          this.items = sortItems(items)
          this.snippets = snippets
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          throw e
        } finally {
          this.loading = false
        }
      },

      async createItem(item: PromptItem): Promise<PromptItem> {
        this.saving = true
        this.error = ''
        try {
          const parsed = promptItemSchema.parse(item)
          await repository.putItem(parsed)
          this.items = sortItems([parsed, ...this.items.filter((row) => row.id !== parsed.id)])
          return parsed
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          throw e
        } finally {
          this.saving = false
        }
      },

      async updateItem(item: PromptItem): Promise<PromptItem> {
        const current = this.items.find((row) => row.id === item.id)
        if (!current) return this.createItem(item)
        this.saving = true
        this.error = ''
        try {
          const history = [
            ...current.history,
            {
              version: current.version,
              updatedAt: current.updatedAt,
              summary: summaryOf(current),
            },
          ].slice(-10)
          const parsed = promptItemSchema.parse({
            ...item,
            createdAt: current.createdAt,
            version: current.version + 1,
            history,
          })
          await repository.putItem(parsed)
          this.items = sortItems(this.items.map((row) => (row.id === parsed.id ? parsed : row)))
          return parsed
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          throw e
        } finally {
          this.saving = false
        }
      },

      async removeItem(id: string): Promise<void> {
        this.error = ''
        try {
          await repository.deleteItem(id)
          this.items = this.items.filter((item) => item.id !== id)
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          throw e
        }
      },

      async toggleFavorite(id: string): Promise<void> {
        const item = this.items.find((row) => row.id === id)
        if (!item) return
        await this.updateItem({ ...item, isFavorite: !item.isFavorite, updatedAt: Date.now() })
      },

      async incrementUsage(id: string): Promise<void> {
        const item = this.items.find((row) => row.id === id)
        if (!item) return
        const next = promptItemSchema.parse({
          ...item,
          usageCount: item.usageCount + 1,
          updatedAt: Date.now(),
        })
        await repository.putItem(next)
        this.items = sortItems(this.items.map((row) => (row.id === id ? next : row)))
      },

      async saveSnippet(snippet: PromptSnippet): Promise<void> {
        const parsed = promptSnippetSchema.parse(snippet)
        await repository.putSnippet(parsed)
        this.snippets = [
          parsed,
          ...this.snippets.filter((row) => row.id !== parsed.id),
        ].sort((a, b) => b.updatedAt - a.updatedAt)
      },

      async removeSnippet(id: string): Promise<void> {
        await repository.deleteSnippet(id)
        this.snippets = this.snippets.filter((row) => row.id !== id)
      },

      async loadMedia(itemId: string): Promise<PromptMediaRecord[]> {
        return repository.listMediaByItem(itemId)
      },

      async saveMedia(media: PromptMediaRecord): Promise<void> {
        await repository.putMedia(media)
      },

      async removeMedia(mediaId: string): Promise<void> {
        await repository.deleteMedia(mediaId)
      },
    },
  })
}

const promptRepository = new DexiePromptRepository(db)
export const usePromptsStore = createPromptsStore(promptRepository)
