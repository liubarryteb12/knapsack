import { CalendarDays } from '@lucide/vue'
import type { ModManifest } from '../../core/modRegistry'
import {
  SHAREABLE_PACKAGE_EXPORT_TOPIC,
  SHAREABLE_PACKAGE_IMPORT_TOPIC,
} from '../../core/types/shareable-package.schema'

const manifest: ModManifest = {
  id: 'mod-daily',
  name: '日常规划',
  version: '1.3.0',
  schemaRevision: 0,
  description: '每日计划、随手备忘与结构化复盘',
  enabledByDefault: true,
  dbStores: [
    {
      name: 'mod_daily_days',
      keyPath: 'date',
      indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }],
      legacyName: 'dailyDays',
    },
  ],
  routes: [
    {
      path: '/daily',
      name: 'daily',
      component: () => import('./DailyView.vue'),
    },
  ],
  navItems: [{ label: '每日', to: '/daily', icon: CalendarDays, order: 20 }],
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
}

export default manifest
