import { Map } from '@lucide/vue'
import { defineAsyncComponent } from 'vue'
import type { ModManifest } from '../../core/modRegistry'
import { SPECIAL_EXPENSE_LEDGER_TOPIC } from '../../core/capabilityContracts'
import {
  SHAREABLE_PACKAGE_EXPORT_TOPIC,
  SHAREABLE_PACKAGE_IMPORT_TOPIC,
} from '../../core/types/shareable-package.schema'

const manifest: ModManifest = {
  id: 'mod-trip',
  name: '旅行',
  version: '1.3.0',
  schemaRevision: 0,
  description: '行程、预算与行李',
  enabledByDefault: true,
  dbStores: [
    {
      name: 'mod_trip_trips',
      keyPath: 'id',
      indexes: [{ name: 'name', keyPath: 'name' }, { name: 'startDate', keyPath: 'startDate' }],
      legacyName: 'trips',
    },
  ],
  routes: [
    { path: '/', name: 'trips', component: () => import('./TripsView.vue') },
    {
      path: '/trip/:id',
      name: 'trip-detail',
      component: () => import('./TripDetailView.vue'),
    },
  ],
  navItems: [
    { label: '旅行', to: '/', icon: Map, order: 10 },
  ],
  providesCapabilities: {
    [SPECIAL_EXPENSE_LEDGER_TOPIC]: async () => {
      const { listSpecialExpenseLedger } = await import('./services/tripFinanceBridge')
      return listSpecialExpenseLedger()
    },
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
      targetSlot: 'daily:header-banner',
      component: defineAsyncComponent(() => import('./components/TripDailyBanner.vue')),
      order: 10,
    },
  ],
}

export default manifest
