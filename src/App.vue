<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider, NMessageProvider, NGlobalStyle, zhCN, dateZhCN, darkTheme, type GlobalThemeOverrides } from 'naive-ui'
import { RouterLink, RouterView } from 'vue-router'
import { Map, Settings, Backpack } from '@lucide/vue'
import { useThemeStore } from './stores/theme'

const theme = useThemeStore()

/** Naive UI 主色统一为应用靛蓝：之前主按钮是默认绿，和页面 accent 打架 */
const themeOverrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: '#4f46e5',
    primaryColorHover: '#4338ca',
    primaryColorPressed: '#3730a3',
    primaryColorSuppl: '#4338ca',
    borderRadius: '8px',
    fontSize: '14px',
  },
}))
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme="theme.isDark ? darkTheme : null" :theme-overrides="themeOverrides">
    <n-global-style />
    <n-message-provider>
      <div class="app-shell">
        <aside class="app-sidebar">
          <div class="app-logo">
            <span class="app-logo-icon"><Backpack :size="20" :stroke-width="2" /></span>
            <span class="app-logo-text">行囊</span>
          </div>
          <nav class="app-nav">
            <RouterLink class="app-nav-item" to="/" exact-active-class="router-link-active">
              <span class="app-nav-icon"><Map :size="19" :stroke-width="2" /></span>
              <span>旅行</span>
            </RouterLink>
            <RouterLink class="app-nav-item" to="/settings" exact-active-class="router-link-active">
              <span class="app-nav-icon"><Settings :size="19" :stroke-width="2" /></span>
              <span>设置</span>
            </RouterLink>
          </nav>
          <p class="app-version">v1.0.1</p>
        </aside>
        <main class="app-main">
          <RouterView v-slot="{ Component }">
            <Transition name="page" mode="out-in">
              <component :is="Component" />
            </Transition>
          </RouterView>
        </main>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.app-sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--app-border);
  background: var(--app-nav-bg);
  padding: var(--space-4) var(--space-3);
  gap: var(--space-2);
  transition: background-color var(--dur-normal) var(--ease), border-color var(--dur-normal) var(--ease);
}

.app-logo {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-5);
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.app-logo-icon {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--app-accent-solid);
  color: var(--app-accent-on);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
}

.app-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.app-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px var(--space-3);
  border-radius: var(--radius-md);
  color: var(--app-text-secondary);
  text-decoration: none;
  font-size: var(--text-md);
  font-weight: 500;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.app-nav-item:hover {
  background: var(--app-hover-bg);
}

/* 激活态：左侧竖条 + 浅靛蓝底 */
.app-nav-item.router-link-active {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  font-weight: 600;
}

.app-nav-item.router-link-active::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--app-accent-solid);
}

.app-nav-icon {
  display: flex;
  align-items: center;
}

.app-version {
  margin-top: auto;
  padding: 0 var(--space-3);
  color: var(--app-faint);
  font-size: var(--text-xs);
}

.app-main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--app-bg);
  transition: background-color var(--dur-normal) var(--ease);
}

/* 路由切换过渡 */
.page-enter-active,
.page-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

/* 窄屏（手机 / 安卓 APK）：侧边栏改为底部导航 */
@media (max-width: 720px) {
  .app-shell {
    flex-direction: column-reverse;
  }

  .app-sidebar {
    width: 100%;
    flex-direction: row;
    align-items: center;
    justify-content: space-around;
    border-right: none;
    border-top: 1px solid var(--app-border);
    padding: var(--space-1) var(--space-2);
    padding-bottom: calc(var(--space-1) + env(safe-area-inset-bottom));
    gap: var(--space-1);
  }

  .app-logo,
  .app-version {
    display: none;
  }

  .app-nav {
    flex-direction: row;
    flex: 1;
    justify-content: space-around;
    gap: 0;
  }

  .app-nav-item {
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 20px;
    font-size: 11px;
  }

  /* 底部导航不要左竖条 */
  .app-nav-item.router-link-active::before {
    display: none;
  }

  .app-nav-icon {
    font-size: 20px;
  }
}
</style>
