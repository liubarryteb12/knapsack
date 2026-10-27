<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NInput,
  NModal,
  NProgress,
  NSelect,
  NTabPane,
  NTabs,
  NTag,
  useMessage,
} from 'naive-ui'
import QRCode from 'qrcode'
import { nanoid } from 'nanoid'
import { parseShareablePackage, type ShareablePackage } from '../../../core/types/shareable-package.schema'
import { verifyShareablePackage } from '../../../engines/lan-share-engine/digest-signer'
import {
  createPacketFrames,
  PacketReceiver,
  type PacketChunkResult,
} from '../../../engines/lan-share-engine/packet-chunker'
import { canScan } from '../../../engines/lan-share-engine/lanSessionScan'
import QrScanner from '../../../engines/lan-share-engine/QrScanner.vue'
import { TEAM_PACKAGE_RECORD_FORMAT, type TeamPackageRecord } from '../schema/team-package.schema'
import { useTeamPackageStore } from '../store/teamPackageStore'

const props = defineProps<{
  show: boolean
  records: TeamPackageRecord[]
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  received: [record: TeamPackageRecord]
}>()

const store = useTeamPackageStore()
const message = useMessage()
const tab = ref<'send' | 'receive'>('send')
const selectedSendId = ref<string | null>(null)
const packet = ref<PacketChunkResult | null>(null)
const frameIndex = ref(0)
const qrUrl = ref('')
const playing = ref(false)
const manualFrame = ref('')
const scannerOpen = ref(false)
const receiver = ref(new PacketReceiver())
const scanProgress = ref({ received: 0, total: 0, percent: 0 })
const receivedPackage = ref<ShareablePackage | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
let qrSequence = 0
let sendSequence = 0

const sendOptions = computed(() =>
  props.records
    .filter((record) => record.direction === 'SENT')
    .map((record) => ({
      value: record.recordId,
      label: `${record.package.title} · ${record.package.permissionMode === 'READ_ONLY' ? '只读' : '协同'}`,
    })),
)

const selectedSendRecord = computed(() =>
  props.records.find((record) => record.recordId === selectedSendId.value) ?? null,
)

watch(
  () => props.show,
  async (show) => {
    if (!show) {
      sendSequence++
      stopPlayback()
      return
    }
    tab.value = sendOptions.value.length > 0 ? 'send' : 'receive'
    selectedSendId.value = sendOptions.value[0]?.value ?? null
  },
)

watch(selectedSendId, async (id) => {
  const sequence = ++sendSequence
  stopPlayback()
  packet.value = null
  qrUrl.value = ''
  const record = props.records.find((item) => item.recordId === id)
  if (!record) return
  try {
    const generated = await createPacketFrames(record.package, {
      packageId: record.package.packageId,
      digest: record.package.digest,
    })
    if (sequence !== sendSequence) return
    packet.value = generated
    frameIndex.value = 0
    await renderFrame()
  } catch (error) {
    if (sequence === sendSequence) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }
})

async function renderFrame() {
  if (!packet.value) return
  const text = packet.value.frames[frameIndex.value % packet.value.frames.length]
  if (!text) return
  const sequence = ++qrSequence
  const url = await QRCode.toDataURL(text, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: 'L',
  })
  if (sequence === qrSequence) qrUrl.value = url
}

function stopPlayback() {
  playing.value = false
  if (timer) clearInterval(timer)
  timer = null
}

async function startPlayback() {
  if (!packet.value) return
  stopPlayback()
  if (packet.value.frames.length === 1) {
    await renderFrame()
    message.info('单帧二维码，无需轮播')
    return
  }
  playing.value = true
  timer = setInterval(() => {
    frameIndex.value = (frameIndex.value + 1) % packet.value!.frames.length
    void renderFrame()
  }, 250)
}

async function processFrame(text: string) {
  try {
    const receipt = receiver.value.receiveChunk(text.trim())
    scanProgress.value = receipt.progress
    manualFrame.value = ''
    if (!receiver.value.isComplete) return
    scannerOpen.value = false
    const raw = await receiver.value.complete<ShareablePackage>()
    const incoming = parseShareablePackage(raw)
    if (!(await verifyShareablePackage(incoming))) throw new Error('共享包摘要校验失败')
    const previous = store.records
      .filter((record) => record.packageId === incoming.packageId)
      .sort((left, right) => right.package.revision - left.package.revision)[0]
    const duplicate = store.records.find(
      (record) =>
        record.packageId === incoming.packageId &&
        record.package.revision === incoming.revision &&
        record.package.digest === incoming.digest,
    )
    if (duplicate) {
      scannerOpen.value = false
      receivedPackage.value = incoming
      message.info('这份共享包已经接收过，未新增重复记录')
      return
    }
    const sameRevision = store.records.find(
      (record) =>
        record.packageId === incoming.packageId &&
        record.package.revision === incoming.revision,
    )
    if (sameRevision) throw new Error('同一版本出现不同内容，已拒绝接收')
    if (previous && incoming.revision < previous.package.revision) {
      throw new Error(`已接收更高版本 v${previous.package.revision}，拒绝旧版本`)
    }
    const now = Date.now()
    const record = await store.save({
      format: TEAM_PACKAGE_RECORD_FORMAT,
      recordId: nanoid(14),
      groupId: previous?.groupId ?? null,
      packageId: incoming.packageId,
      direction: 'RECEIVED',
      status: 'PENDING_REVIEW',
      package: incoming,
      previousPackage: previous?.package ?? null,
      createdAt: now,
      updatedAt: now,
    })
    receivedPackage.value = incoming
    emit('received', record)
    message.success('共享包已收齐并通过摘要校验')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function resetReceiver() {
  receiver.value = new PacketReceiver()
  scanProgress.value = { received: 0, total: 0, percent: 0 }
  receivedPackage.value = null
  manualFrame.value = ''
}

onBeforeUnmount(stopPlayback)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="面对面扫码收发"
    style="width: min(680px, calc(100vw - 32px))"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <n-tabs v-model:value="tab" type="segment" animated>
      <n-tab-pane name="send" tab="发送共享包">
        <div v-if="sendOptions.length === 0" class="empty">
          还没有已装箱共享包。请先从「装箱分享」创建发送记录。
        </div>
        <div v-else class="send-panel">
          <n-select v-model:value="selectedSendId" :options="sendOptions" />
          <div v-if="packet" class="packet-meta">
            <n-tag size="small" :bordered="false">
              {{ packet.mode === 'single' ? '单帧二维码' : `${packet.frames.length} 帧轮播` }}
            </n-tag>
            <span>{{ selectedSendRecord?.package.title }}</span>
          </div>
          <div class="qr-stage">
            <img v-if="qrUrl" :src="qrUrl" class="qr" alt="共享包二维码" />
            <span v-else class="qr-placeholder">正在生成二维码</span>
          </div>
          <div class="send-actions">
            <span class="muted">
              {{ packet?.frames.length ? `${frameIndex + 1} / ${packet.frames.length}` : '' }}
            </span>
            <n-button v-if="packet && packet.frames.length > 1" size="small" @click="playing ? stopPlayback() : startPlayback()">
              {{ playing ? '暂停轮播' : '开始轮播' }}
            </n-button>
          </div>
        </div>
      </n-tab-pane>

      <n-tab-pane name="receive" tab="接收共享包">
        <div class="receive-panel">
          <n-alert type="info" :bordered="false">
            连续扫描对方轮播二维码，乱序也能自动拼装。收齐后会先进入待审核，不会直接改写业务表。
          </n-alert>
          <div class="receive-actions">
            <n-button v-if="canScan()" type="primary" @click="scannerOpen = true">
              打开相机扫码
            </n-button>
            <n-button @click="resetReceiver">重新接收</n-button>
          </div>
          <div v-if="scannerOpen" class="scanner-box">
            <QrScanner
              @scanned="(text: string) => void processFrame(text)"
              @error="(text: string) => message.error(`扫码失败：${text}`)"
            />
            <n-button size="small" @click="scannerOpen = false">关闭相机</n-button>
          </div>
          <n-progress
            type="line"
            :percentage="scanProgress.percent"
            :height="8"
            :show-indicator="false"
          />
          <p class="muted">
            已接收 {{ scanProgress.received }} / {{ scanProgress.total || '?' }} 片
          </p>
          <div class="manual-frame">
            <n-input
              v-model:value="manualFrame"
              type="textarea"
              :rows="2"
              placeholder="也可粘贴单帧 KNAP|… 内容"
            />
            <n-button :disabled="!manualFrame.trim()" @click="processFrame(manualFrame)">接收当前帧</n-button>
          </div>
          <n-alert v-if="receivedPackage" type="success" :bordered="false">
            {{ receivedPackage.title }} 已收齐，请到待审列表查看。
          </n-alert>
        </div>
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<style scoped>
.send-panel,
.receive-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.packet-meta,
.send-actions,
.receive-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.qr-stage {
  width: min(360px, 100%);
  aspect-ratio: 1;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: #fff;
  overflow: hidden;
}

.qr {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}

.qr-placeholder {
  color: #667085;
  font-size: 12px;
}

.send-actions {
  justify-content: space-between;
}

.scanner-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
}

.manual-frame {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--space-2);
}

.empty {
  padding: var(--space-8) var(--space-3);
  color: var(--app-muted);
  text-align: center;
}

.muted {
  color: var(--app-muted);
  font-size: var(--text-xs);
}

@media (max-width: 600px) {
  .manual-frame {
    grid-template-columns: 1fr;
  }
}
</style>
