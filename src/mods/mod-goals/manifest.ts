import { Target } from '@lucide/vue'
import type { ModManifest } from '../../core/modRegistry'

const manifest: ModManifest = {
  id: 'mod-goals',
  name: '目标',
  version: '1.5.4',
  schemaRevision: 2,
  description: '想法池、目标树、思维导图与层级任务，支持 AI 拆解与 goal-pack 导入',
  enabledByDefault: true,
  dbStores: [
    {
      name: 'mod_goals_ideas',
      keyPath: 'id',
      indexes: [
        { name: 'status', keyPath: 'status' },
        { name: 'updatedAt', keyPath: 'updatedAt' },
        { name: 'externalId', keyPath: 'externalId' },
      ],
    },
    {
      name: 'mod_goals_goals',
      keyPath: 'id',
      indexes: [
        { name: 'status', keyPath: 'status' },
        { name: 'statusPriority', keyPath: ['status', 'priority'] },
        { name: 'targetDate', keyPath: 'targetDate' },
        { name: 'externalId', keyPath: 'externalId' },
      ],
    },
    {
      name: 'mod_goals_milestones',
      keyPath: 'id',
      indexes: [
        { name: 'goalId', keyPath: 'goalId' },
        { name: 'goalOrder', keyPath: ['goalId', 'order'] },
        { name: 'externalId', keyPath: 'externalId' },
      ],
    },
    {
      name: 'mod_goals_tasks',
      keyPath: 'id',
      indexes: [
        { name: 'milestoneId', keyPath: 'milestoneId' },
        { name: 'milestoneOrder', keyPath: ['milestoneId', 'order'] },
        { name: 'cycleId', keyPath: 'cycleId' },
        { name: 'status', keyPath: 'status' },
        { name: 'roleId', keyPath: 'roleId' },
        { name: 'externalId', keyPath: 'externalId' },
      ],
    },
    {
      name: 'mod_goals_cycles',
      keyPath: 'id',
      indexes: [
        { name: 'goalId', keyPath: 'goalId' },
        { name: 'goalStart', keyPath: ['goalId', 'startDate'] },
        { name: 'externalId', keyPath: 'externalId' },
      ],
    },
    {
      name: 'mod_goals_imports',
      keyPath: 'id',
      indexes: [
        { name: 'importedAt', keyPath: 'importedAt' },
        { name: 'idempotencyKey', keyPath: 'idempotencyKey' },
      ],
    },
    {
      name: 'mod_goals_roles',
      keyPath: 'id',
      indexes: [
        { name: 'active', keyPath: 'active' },
        { name: 'tier', keyPath: 'tier' },
        { name: 'updatedAt', keyPath: 'updatedAt' },
      ],
    },
  ],
  routes: [
    {
      path: '/goals',
      name: 'goals',
      component: () => import('./GoalsView.vue'),
    },
    {
      path: '/goals/:id',
      name: 'goal-detail',
      component: () => import('./GoalDetailView.vue'),
    },
  ],
  navItems: [{ label: '目标', to: '/goals', icon: Target, order: 25 }],
}

export default manifest
