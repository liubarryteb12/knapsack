import { Sparkles } from '@lucide/vue'
import { defineAsyncComponent } from 'vue'
import type { ModManifest } from '../../core/modRegistry'
import {
  SHAREABLE_PACKAGE_EXPORT_TOPIC,
  SHAREABLE_PACKAGE_IMPORT_TOPIC,
} from '../../core/types/shareable-package.schema'

const manifest: ModManifest = {
  id: 'mod-prompts',
  name: '提示词库',
  version: '1.3.0',
  schemaRevision: 0,
  description: '工作、生图与生视频提示词的本地收集、组装与复用',
  enabledByDefault: true,
  dbStores: [
    {
      name: 'mod_prompts_items',
      keyPath: 'id',
      indexes: [
        { name: 'modality', keyPath: 'modality' },
        { name: 'updatedAt', keyPath: 'updatedAt' },
        { name: 'usageCount', keyPath: 'usageCount' },
        { name: 'isFavorite', keyPath: 'isFavorite' },
      ],
    },
    {
      name: 'mod_prompts_snippets',
      keyPath: 'id',
      indexes: [
        { name: 'category', keyPath: 'category' },
        { name: 'updatedAt', keyPath: 'updatedAt' },
        { name: 'usageCount', keyPath: 'usageCount' },
      ],
    },
    {
      name: 'mod_prompts_media',
      keyPath: 'mediaId',
      indexes: [
        { name: 'itemId', keyPath: 'itemId' },
        { name: 'createdAt', keyPath: 'createdAt' },
      ],
    },
  ],
  routes: [
    {
      path: '/prompts',
      name: 'prompts',
      component: () => import('./PromptsView.vue'),
    },
  ],
  navItems: [{ label: '提示词', to: '/prompts', icon: Sparkles, order: 35 }],
  providesCapabilities: {
    [SHAREABLE_PACKAGE_EXPORT_TOPIC]: async (request) => {
      const { exportShareablePackages } = await import('./services/shareAdapter')
      return exportShareablePackages(request)
    },
    [SHAREABLE_PACKAGE_IMPORT_TOPIC]: async (request) => {
      const { importShareablePackage } = await import('./services/shareAdapter')
      return importShareablePackage(request)
    },
  },
  slotContributions: [
    {
      targetSlot: 'host:quick-action',
      component: defineAsyncComponent(() => import('./components/PromptQuickSave.vue')),
      order: 10,
    },
    {
      targetSlot: 'daily:review-footer',
      component: defineAsyncComponent(() => import('./components/PromptDailyFootprint.vue')),
      order: 20,
    },
  ],
}

export default manifest
