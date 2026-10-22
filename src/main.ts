import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)

/**
 * 全局兜底（S5）：WebView 里未捕获的异常和未处理的 Promise rejection 原本只会进
 * console，用户侧看到的就是白屏或「闪退」。这里统一留证——环形缓冲写 localStorage，
 * 出问题时能拿到现场，而不是只能靠猜。
 */
const CRASH_LOG_KEY = 'knapsack.crash-log.v1'
const CRASH_LOG_LIMIT = 20

function recordFatal(scope: string, detail: unknown): void {
  try {
    const entry = {
      at: new Date().toISOString(),
      scope,
      message: detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail),
      stack: detail instanceof Error ? (detail.stack ?? '') : '',
    }
    const raw = localStorage.getItem(CRASH_LOG_KEY)
    const list: unknown[] = raw ? (JSON.parse(raw) as unknown[]) : []
    list.push(entry)
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(list.slice(-CRASH_LOG_LIMIT)))
  } catch {
    /* 记录失败不能反过来影响主流程 */
  }
  console.error(`[knapsack:${scope}]`, detail)
}

app.config.errorHandler = (err, _instance, info) => recordFatal(`vue:${info}`, err)

window.addEventListener('error', (e: ErrorEvent) => recordFatal('window.error', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => recordFatal('unhandledrejection', e.reason))

app.use(createPinia())
app.use(router)
app.mount('#app')
