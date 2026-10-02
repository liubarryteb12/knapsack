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

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      systemDark.value = e.matches
    })
  }

  function setMode(next: ThemeMode) {
    mode.value = next
  }

  return { mode, isDark, setMode }
})
