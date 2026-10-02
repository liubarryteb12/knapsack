<script setup lang="ts">
/**
 * 相机扫码组件：把 html5-qrcode 挂到一个 div 上，扫到就抛事件并自动关摄像头。
 * 用原生后置摄像头（facingMode: environment）；离开组件/扫到/取消都会释放。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Html5Qrcode } from 'html5-qrcode'

const emit = defineEmits<{
  (e: 'scanned', text: string): void
  (e: 'error', msg: string): void
}>()

const elId = `knapsack-qr-${Math.random().toString(36).slice(2, 9)}`
const starting = ref(true)
let scanner: Html5Qrcode | null = null
let stopped = false

async function stop() {
  if (stopped) return
  stopped = true
  const s = scanner
  scanner = null
  if (!s) return
  try {
    await s.stop()
    s.clear()
  } catch {
    /* 已经停了就忽略 */
  }
}

onMounted(async () => {
  try {
    // 动态导入：html5-qrcode 约 370KB，只有真要扫码时才加载
    const { Html5Qrcode } = await import('html5-qrcode')
    if (stopped) return
    scanner = new Html5Qrcode(elId, { verbose: false })
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 230, height: 230 } },
      (text) => {
        void stop()
        emit('scanned', text)
      },
      () => {
        /* 每一帧没解出来是常态，忽略 */
      },
    )
    starting.value = false
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('error', msg)
  }
})

onBeforeUnmount(() => {
  void stop()
})

defineExpose({ stop })
</script>

<template>
  <div class="scanner">
    <div :id="elId" class="scan-area" />
    <p v-if="starting" class="muted small">正在打开摄像头…</p>
    <p class="muted small">把主机屏幕上的二维码放进取景框</p>
  </div>
</template>

<style scoped>
.scanner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.scan-area {
  width: 100%;
  max-width: 320px;
  min-height: 240px;
  border-radius: 10px;
  overflow: hidden;
  background: #111;
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: 12px;
}
</style>
