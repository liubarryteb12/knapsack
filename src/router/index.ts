import { createRouter, createWebHashHistory } from 'vue-router'
import { modRegistry } from '../core/bootMods'

// 桌面/移动端离线应用，用 hash 模式避免文件协议或 WebView 路由问题
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    ...modRegistry.manifests.flatMap((manifest) =>
      manifest.routes.map((route) => ({
        ...route,
        meta: { ...route.meta, mod: manifest.id },
      })),
    ),
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    {
      path: '/:pathMatch(.*)*',
      redirect: () => modRegistry.enabledNavItems[0]?.to ?? '/settings',
    },
  ],
})

router.beforeEach((to) => {
  const mod = to.meta.mod
  if (typeof mod === 'string' && !modRegistry.isEnabled(mod as `mod-${string}`)) {
    return { name: 'settings' }
  }
})

export default router
