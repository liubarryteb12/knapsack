import { Users } from '@lucide/vue'
import type { ModManifest } from '../../core/modRegistry'

const manifest: ModManifest = {
  id: 'mod-team',
  name: '团队分享',
  version: '1.3.0',
  schemaRevision: 1,
  description: '面对面团队组建与快照收发',
  enabledByDefault: true,
  dbStores: [
    {
      name: 'mod_team_groups',
      keyPath: 'teamId',
      legacyNames: ['teamState', 'mod_trip_team_state'],
    },
    {
      name: 'mod_team_publications',
      keyPath: 'publicationId',
      indexes: [
        { name: 'teamId', keyPath: 'teamId' },
        { name: 'teamVersion', keyPath: ['teamId', 'version'] },
      ],
      legacyNames: ['teamPublications', 'mod_trip_team_publications'],
    },
    {
      name: 'mod_team_outbox',
      keyPath: 'operationId',
      indexes: [
        { name: 'teamId', keyPath: 'teamId' },
        { name: 'kind', keyPath: 'kind' },
        { name: 'createdAt', keyPath: 'createdAt' },
      ],
      legacyNames: ['teamOutbox', 'mod_trip_team_outbox'],
    },
    {
      name: 'mod_team_idempotency',
      keyPath: 'idempotencyKey',
      indexes: [{ name: 'teamId', keyPath: 'teamId' }],
      legacyNames: ['teamIdempotency', 'mod_trip_team_idempotency'],
    },
    {
      name: 'mod_team_link',
      keyPath: 'teamId',
      legacyNames: ['teamLink', 'mod_trip_team_link'],
    },
    {
      name: 'mod_team_packages',
      keyPath: 'recordId',
      indexes: [
        { name: 'groupId', keyPath: 'groupId' },
        { name: 'packageId', keyPath: 'packageId' },
        { name: 'status', keyPath: 'status' },
        { name: 'updatedAt', keyPath: 'updatedAt' },
      ],
    },
  ],
  routes: [
    {
      path: '/team-hub',
      name: 'team-hub',
      component: () => import('./views/TeamHubView.vue'),
    },
    { path: '/teams', name: 'teams', component: () => import('./views/TeamsView.vue') },
    {
      path: '/team/:id',
      name: 'team-detail',
      component: () => import('./views/TeamDetailView.vue'),
    },
  ],
  navItems: [
    {
      label: '团队',
      to: '/team-hub',
      icon: Users,
      order: 40,
      activePaths: ['/teams', '/team'],
    },
  ],
}

export default manifest
