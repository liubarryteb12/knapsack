import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'knapsack.theme'

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function loadMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** 外观设置：浅色 / 深色 / 跟随系统。落地为 <html data-theme="dark|light">，CSS 变量随之切换 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(loadMode())
  const systemDark = ref(systemPrefersDark())

  const isDark = computed(() =>
    mode.value === 'system' ? systemDark.value : mode.value === 'dark',
  )

  watch(
    isDark,
    (dark) => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    },
    { immediate: true },
  )

  watch(mode, (next) => {
    localStorage.setItem(STORAGE_KEY, next)
  })

  // MediaQueryList 每次调用 matchMedia 都会新建，必须保存引用才能去重/移除。
  // Pinia store 是单例，正常只有一份；HMR 重跑 setup 时先移除旧监听再挂新的。
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      systemDark.value = e.matches
    }
    mql.removeEventListener('change', onChange)
    mql.addEventListener('change', onChange)
  }

  function setMode(next: ThemeMode) {
    mode.value = next
  }

  return { mode, isDark, setMode }
})
