<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import QRCode from 'qrcode'
import { useTripsStore } from '../stores/trips'
import { useHistoryStore } from '../stores/history'
import { tripSchema, type Trip } from '../schema/trip'
import {
  buildJoinPayload,
  parseJoinPayload,
  fetchInfo,
  pullTrip,
  pushTrip,
  type JoinTarget,
} from '../utils/lanSessionProtocol'
import {
  canHost,
  startSession,
  stopSession,
  getSessionStatus,
  updateSessionTrip,
  onSessionPushed,
  type HostSessionInfo,
} from '../utils/lanSessionHost'
import { canScan } from '../utils/lanSessionScan'
import QrScanner from './QrScanner.vue'
import type { UnlistenFn } from '@tauri-apps/api/event'

const props = defineProps<{ show: boolean; trip: Trip }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const tripsStore = useTripsStore()
const history = useHistoryStore()
const message = useMessage()

const isHost = canHost()
const canUseScanner = canScan()

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 传给 Tauri 命令前去掉 Vue 响应式代理，避免序列化出意外字段 */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

// ---------- 主机侧 ----------

const hosting = ref<HostSessionInfo | null>(null)
const hostIp = ref('')
const qrUrl = ref('')
const starting = ref(false)
let unlisten: UnlistenFn | null = null

const ipOptions = computed(
  () => hosting.value?.ipCandidates.map((ip) => ({ label: ip, value: ip })) ?? [],
)

const joinPayload = computed(() =>
  hosting.value
    ? buildJoinPayload({
        ip: hostIp.value || hosting.value.ip,
        port: hosting.value.port,
        keyB64: hosting.value.keyB64,
        sessionId: hosting.value.sessionId,
      })
    : '',
)

async function refreshQr() {
  if (!hosting.value) return
  qrUrl.value = await QRCode.toDataURL(joinPayload.value, {
    width: 300,
    margin: 1,
    errorCorrectionLevel: 'M',
  })
}

async function startHosting() {
  starting.value = true
  try {
    const info = await startSession(plain(props.trip))
    hosting.value = info
    hostIp.value = info.ip
    await refreshQr()
    if (!unlisten) unlisten = await onSessionPushed(applyPushedTrip)
    message.success(`会话已开启，等待接入（${info.ip}:${info.port}）`)
  } catch (e) {
    message.error(`开启会话失败：${errText(e)}`)
  } finally {
    starting.value = false
  }
}

/** 接入方推来一份行程：过 Zod 后覆盖本地，覆盖前压撤销栈 */
async function applyPushedTrip(raw: unknown) {
  let incoming: Trip
  try {
    incoming = tripSchema.parse(raw)
  } catch {
    message.error('接入方推来的行程没通过校验，已拒绝写入')
    return
  }
  const local = tripsStore.trips.find((t) => t.id === incoming.id)
  if (local) history.push(local, '接入方推送前的版本')
  await tripsStore.importTrip(incoming, local ? 'overwrite' : 'asNew')
  message.success(
    local
      ? `已用接入方版本覆盖「${incoming.name}」，可撤销`
      : `已保存接入方推来的「${incoming.name}」`,
  )
}

async function stopHosting() {
  try {
    await stopSession()
  } catch {
    /* 会话可能已关，忽略 */
  }
  hosting.value = null
  hostIp.value = ''
  qrUrl.value = ''
  if (unlisten) {
    unlisten()
    unlisten = null
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(joinPayload.value)
    message.success('会话码已复制')
  } catch {
    message.warning('复制失败，请手动长按选中')
  }
}

// 切换网卡地址后重画二维码
watch(hostIp, () => {
  void refreshQr()
})

// 主机本地改动后把最新副本同步到服务端内存
watch(
  () => props.trip,
  async (t) => {
    if (!hosting.value) return
    try {
      await updateSessionTrip(plain(t))
    } catch {
      /* 会话已关闭等情况忽略 */
    }
  },
)

// ---------- 接入方（手机） ----------

const joinCode = ref('')
const target = ref<JoinTarget | null>(null)
const hostTripName = ref('')
const joining = ref(false)
const pulling = ref(false)
const pushing = ref(false)

async function connect(codeText?: string) {
  const code = (codeText ?? joinCode.value).trim()
  if (!code) return
  joining.value = true
  target.value = null
  try {
    const t = parseJoinPayload(code)
    const info = await fetchInfo(t)
    target.value = t
    hostTripName.value = info.tripName
    joinCode.value = code
    message.success(`已连上主机，会话号 ${info.sessionId}`)
  } catch (e) {
    message.error(errText(e))
  } finally {
    joining.value = false
  }
}

const showScanner = ref(false)

async function doScan() {
  showScanner.value = true
}

function onScanned(text: string) {
  showScanner.value = false
  void connect(text)
}

function onScanError(msg: string) {
  showScanner.value = false
  message.error(`扫码失败：${msg}（可改用下面的会话码粘贴）`)
}

async function doPull() {
  if (!target.value) return
  pulling.value = true
  try {
    const raw = await pullTrip(target.value)
    const incoming = tripSchema.parse(raw)
    const local = tripsStore.trips.find((t) => t.id === incoming.id)
    if (local) history.push(local, '从局域网主机拉取前的版本')
    await tripsStore.importTrip(incoming, local ? 'overwrite' : 'asNew')
    message.success(
      local ? `已用主机版本覆盖「${incoming.name}」，可撤销` : `已拉取为「${incoming.name}」`,
    )
  } catch (e) {
    message.error(`拉取失败：${errText(e)}`)
  } finally {
    pulling.value = false
  }
}

async function doPush() {
  if (!target.value) return
  pushing.value = true
  try {
    await pushTrip(target.value, plain(props.trip))
    message.success('已推送到主机，请在主机上查看')
  } catch (e) {
    message.error(`推送失败：${errText(e)}`)
  } finally {
    pushing.value = false
  }
}

// ---------- 打开/关闭 ----------

watch(
  () => props.show,
  async (open) => {
    if (!open) {
      showScanner.value = false // 关面板就释放摄像头
      // 关闭面板就关会话，不留后台监听
      if (hosting.value) await stopHosting()
      return
    }
    if (!isHost) return
    // 重新打开时同步一次真实状态（可能上次没关干净）
    try {
      const st = await getSessionStatus()
      if (st.running && st.info) {
        hosting.value = st.info
        hostIp.value = st.info.ip
        await refreshQr()
        if (!unlisten) unlisten = await onSessionPushed(applyPushedTrip)
      } else {
        hosting.value = null
        hostIp.value = ''
        qrUrl.value = ''
      }
    } catch {
      /* 非 Tauri 环境不会走到这里 */
    }
  },
)

function close() {
  emit('update:show', false)
}

onBeforeUnmount(() => {
  if (hosting.value) void stopHosting()
})
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    title="局域网会话"
    style="width: min(560px, calc(100vw - 32px))"
    @update:show="close"
  >
    <n-alert type="info" :show-icon="false" class="tip">
      同一 WiFi 下直接互传，不经过任何服务器。会话码里含加密密钥，<strong>不要截图外发</strong>；
      载荷用 AES-256-GCM 加密，局域网嗅探只能看到密文。
    </n-alert>

    <!-- 主机（桌面端） -->
    <template v-if="isHost">
      <div v-if="!hosting" class="block">
        <p class="muted">把「{{ props.trip.name }}」共享给同一 WiFi 下的设备。</p>
        <n-button type="primary" :loading="starting" @click="startHosting">开启会话</n-button>
      </div>

      <div v-else class="host-wrap">
        <img v-if="qrUrl" :src="qrUrl" class="qr" alt="局域网会话二维码" />
        <div class="host-side">
          <div class="kv">
            <span class="muted">地址</span>
            <n-select
              v-if="ipOptions.length > 1"
              v-model:value="hostIp"
              size="small"
              :options="ipOptions"
              class="ip-select"
            />
            <code v-else>{{ hostIp }}:{{ hosting.port }}</code>
          </div>
          <div v-if="ipOptions.length > 1" class="kv">
            <span class="muted">端口</span>
            <code>{{ hosting.port }}</code>
          </div>
          <div class="kv">
            <span class="muted">会话号</span>
            <code>{{ hosting.sessionId }}</code>
          </div>
          <p v-if="ipOptions.length > 1" class="muted small">
            本机有多个网卡，手机连不上时请切换地址（换地址会重画二维码）。
          </p>
          <p class="muted small">手机端打开「局域网会话」→ 扫码接入。</p>
          <div class="row">
            <n-button size="small" @click="copyCode">复制会话码</n-button>
            <n-button size="small" type="warning" @click="stopHosting">关闭会话</n-button>
          </div>
        </div>
      </div>
    </template>

    <!-- 接入方（手机） -->
    <template v-else>
      <div v-if="showScanner" class="block">
        <QrScanner @scanned="onScanned" @error="onScanError" />
        <n-button size="small" @click="showScanner = false">取消扫码</n-button>
      </div>

      <div v-else class="block">
        <n-button v-if="canUseScanner" type="primary" class="scan-btn" @click="doScan">
          扫码加入
        </n-button>
        <n-input
          v-model:value="joinCode"
          type="textarea"
          :rows="2"
          class="code-input"
          placeholder="也可以把主机上的会话码粘贴到这里"
        />
        <n-button :loading="joining" :disabled="!joinCode.trim()" @click="connect()">连接</n-button>
      </div>

      <div v-if="target" class="joined">
        <div class="row">
          <n-tag type="success" size="small">已连接</n-tag>
          <span class="muted">主机共享：</span><strong>{{ hostTripName }}</strong>
        </div>
        <div class="row actions">
          <n-button :loading="pulling" @click="doPull">从主机拉取（覆盖本地）</n-button>
          <n-button :loading="pushing" @click="doPush">把我的版本推给主机</n-button>
        </div>
        <p class="muted small">覆盖前会自动把本地旧版本压入撤销栈，随时可撤销。</p>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.tip {
  margin-bottom: 14px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.host-wrap {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.qr {
  width: 220px;
  height: 220px;
  image-rendering: pixelated;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  flex-shrink: 0;
}

.host-side {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.kv {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.kv code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
}

.ip-select {
  min-width: 170px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.actions {
  margin-top: 10px;
}

.joined {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}

.scan-btn {
  width: 100%;
}

.code-input {
  width: 100%;
}

.muted {
  color: #9ca3af;
}

.small {
  font-size: 12px;
}

@media (max-width: 720px) {
  .host-wrap {
    flex-direction: column;
    align-items: center;
  }
}
</style>
