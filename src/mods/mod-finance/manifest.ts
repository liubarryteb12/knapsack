import { Wallet } from '@lucide/vue'
import { defineAsyncComponent } from 'vue'
import type { ModManifest } from '../../core/modRegistry'
import { DAILY_EXPENSE_BRIEF_TOPIC } from '../../core/capabilityContracts'

const manifest: ModManifest = {
  id: 'mod-finance',
  name: '日常账房',
  version: '1.3.0',
  schemaRevision: 2,
  description: '本地花费记录、趋势与消费结构分析',
  enabledByDefault: true,
  dbStores: [
    {
      name: 'mod_finance_entries',
      keyPath: 'id',
      indexes: [
        { name: 'date', keyPath: 'date' },
        { name: 'category', keyPath: 'category' },
        { name: 'natureTag', keyPath: 'natureTag' },
        { name: 'sourceKey', keyPath: 'sourceKey', unique: true },
        { name: 'dateCategory', keyPath: ['date', 'category'] },
      ],
      legacyName: 'financeEntries',
    },
    {
      name: 'mod_finance_budgets',
      keyPath: 'month',
      indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }],
    },
  ],
  routes: [
    {
      path: '/finance',
      name: 'finance',
      component: () => import('./FinanceView.vue'),
    },
  ],
  navItems: [{ label: '账房', to: '/finance', icon: Wallet, order: 30 }],
  slotContributions: [
    {
      targetSlot: 'daily:review-footer',
      component: defineAsyncComponent(() => import('./components/DailyExpenseCard.vue')),
      order: 10,
    },
  ],
  providesCapabilities: {
    [DAILY_EXPENSE_BRIEF_TOPIC]: async (logicalDate: unknown) => {
      const { getDailyExpenseBrief } = await import('./services/dailyBrief')
      return getDailyExpenseBrief(String(logicalDate))
    },
  },
}

export default manifest
