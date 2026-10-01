import { createRouter, createWebHashHistory } from 'vue-router'

// 桌面/移动端离线应用，用 hash 模式避免文件协议或 WebView 路由问题
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'trips', component: () => import('../views/TripsView.vue') },
    { path: '/trip/:id', name: 'trip-detail', component: () => import('../views/TripDetailView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
