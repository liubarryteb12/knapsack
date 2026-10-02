<script setup lang="ts">
import { NConfigProvider, NMessageProvider, zhCN, dateZhCN } from 'naive-ui'
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <div class="app-shell">
        <aside class="app-sidebar">
          <div class="app-logo">
            <span class="app-logo-icon">🎒</span>
            <span class="app-logo-text">行囊</span>
          </div>
          <nav class="app-nav">
            <RouterLink class="app-nav-item" to="/">
              <span class="app-nav-icon">🗺️</span>
              <span>旅行</span>
            </RouterLink>
            <RouterLink class="app-nav-item" to="/settings">
              <span class="app-nav-icon">⚙️</span>
              <span>设置</span>
            </RouterLink>
          </nav>
        </aside>
        <main class="app-main">
          <RouterView />
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
  border-right: 1px solid #e5e7eb;
  background: #fafafa;
  padding: 16px 12px;
  gap: 8px;
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 20px;
  font-size: 20px;
  font-weight: 700;
}

.app-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  color: #374151;
  text-decoration: none;
  font-size: 15px;
  transition: background 0.15s;
}

.app-nav-item:hover {
  background: #eceef1;
}

.app-nav-item.router-link-active {
  background: #e0e7ff;
  color: #4338ca;
  font-weight: 600;
}

.app-nav-icon {
  font-size: 18px;
}

.app-main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #fff;
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
    border-top: 1px solid #e5e7eb;
    padding: 4px 8px;
    padding-bottom: calc(4px + env(safe-area-inset-bottom));
    gap: 4px;
  }

  .app-logo {
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

  .app-nav-icon {
    font-size: 20px;
  }
}
</style>
