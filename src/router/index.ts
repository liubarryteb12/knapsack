import { createRouter, createWebHashHistory } from 'vue-router'
import { modState, type ModId } from '../core/modRegistry'

// 桌面/移动端离线应用，用 hash 模式避免文件协议或 WebView 路由问题
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'trips', component: () => import('../views/TripsView.vue'), meta: { mod: 'trip' } },
    { path: '/trip/:id', name: 'trip-detail', component: () => import('../views/TripDetailView.vue'), meta: { mod: 'trip' } },
    { path: '/teams', name: 'teams', component: () => import('../views/TeamsView.vue'), meta: { mod: 'trip' } },
    { path: '/team/:id', name: 'team-detail', component: () => import('../views/TeamDetailView.vue'), meta: { mod: 'trip' } },
    { path: '/daily', name: 'daily', component: () => import('../mods/mod-daily/DailyView.vue'), meta: { mod: 'daily' } },
    { path: '/finance', name: 'finance', component: () => import('../mods/mod-finance/FinanceView.vue'), meta: { mod: 'finance' } },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const mod = to.meta.mod as ModId | undefined
  if (mod && !modState[mod]) return { name: 'settings' }
})

export default router
