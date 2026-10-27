<script setup lang="ts">
/**
 * 主机 · 分工设置：名册与加入审批、物资需求与批次分工、清点节点。
 * 任何编辑都会推进 draftRevision，发布时用它检测「预览后是否又改过」。
 */
import { computed, ref } from 'vue'
import {
  NButton,
  NCard,
  NInput,
  NInputNumber,
  NSelect,
  NTag,
  NModal,
  NForm,
  NFormItem,
  NPopconfirm,
  useMessage,
} from 'naive-ui'
import { Plus, Check, X } from '@lucide/vue'
import { useTeamsStore } from '../store'
import { newId } from '../domain/protocol'
import { approveJoin, rejectJoin } from '../db/actions'
import type { TeamState } from '../domain/schema'

const props = defineProps<{ team: TeamState }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const teams = useTeamsStore()
const message = useMessage()

const categoryOptions = [
  { label: '食品饮水', value: 'food' },
  { label: '装备器材', value: 'equip' },
  { label: '药品', value: 'medicine' },
  { label: '证件票据', value: 'doc' },
  { label: '其他', value: 'other' },
]

/** 以最新团队快照做一次编辑并落库；自动推进 draftRevision */
async function mutate(fn: (draft: TeamState) => void) {
  const base = JSON.parse(JSON.stringify(props.team)) as TeamState
  fn(base)
  base.draftRevision += 1
  await teams.persist(base)
  emit('changed')
}

// ---------- 名册与审批 ----------

const memberOptions = computed(() =>
  props.team.roster.map((m) => ({ label: `${m.name}${m.role === 'organizer' ? '（组织者）' : ''}`, value: m.memberId })),
)

const pendingJoins = computed(() => props.team.pendingJoins.filter((j) => j.status === 'pending'))

const restoring = ref<Record<string, string>>({})

async function approve(joinRequestId: string) {
  const organizerId = props.team.myMemberId
  if (!organizerId) return
  const restoreMemberId = restoring.value[joinRequestId] || undefined
  const res = await approveJoin({
    teamId: props.team.teamId,
    organizerMemberId: organizerId,
    joinRequestId,
    restoreMemberId,
  })
  if (!res.ok) {
    message.error(res.error)
    return
  }
  message.success(res.restored ? '已恢复配对（保留原身份）' : '已通过，等待对方领取凭证')
  emit('changed')
}

async function reject(joinRequestId: string) {
  const organizerId = props.team.myMemberId
  if (!organizerId) return
  const res = await rejectJoin(props.team.teamId, organizerId, joinRequestId)
  if (!res.ok) {
    message.error(res.error)
    return
  }
  message.success('已拒绝该申请')
  emit('changed')
}

// ---------- 物资与批次 ----------

const showItem = ref(false)
const itemForm = ref({ name: '', category: 'food', qtyNeeded: 1, unit: '个' })

function openItem() {
  itemForm.value = { name: '', category: 'food', qtyNeeded: 1, unit: '个' }
  showItem.value = true
}

async function submitItem() {
  const f = itemForm.value
  if (!f.name.trim()) {
    message.error('请填写物资名称')
    return
  }
  await mutate((d) => {
    d.items.push({
      itemId: newId(),
      name: f.name.trim(),
      category: f.category as never,
      qtyNeeded: f.qtyNeeded,
      unit: f.unit.trim() || '个',
      note: '',
    })
  })
  showItem.value = false
}

async function removeItem(itemId: string) {
  await mutate((d) => {
    d.items = d.items.filter((i) => i.itemId !== itemId)
    // 连带移除该物资的批次，避免悬空引用
    d.allocations = d.allocations.filter((a) => a.itemId !== itemId)
  })
}

const showAlloc = ref(false)
const allocForm = ref({ itemId: '', qtyPlanned: 1, purchaseBy: null as string | null, carryBy: null as string | null })

function openAlloc(itemId?: string) {
  allocForm.value = {
    itemId: itemId ?? props.team.items[0]?.itemId ?? '',
    qtyPlanned: 1,
    purchaseBy: null,
    carryBy: null,
  }
  showAlloc.value = true
}

async function submitAlloc() {
  const f = allocForm.value
  if (!f.itemId) {
    message.error('请先添加物资需求')
    return
  }
  await mutate((d) => {
    d.allocations.push({
      allocationId: newId(),
      itemId: f.itemId,
      qtyPlanned: f.qtyPlanned,
      purchaseBy: f.purchaseBy,
      carryBy: f.carryBy,
      note: '',
    })
  })
  showAlloc.value = false
}

async function removeAlloc(allocationId: string) {
  await mutate((d) => {
    d.allocations = d.allocations.filter((a) => a.allocationId !== allocationId)
  })
}

function memberName(memberId: string | null): string {
  if (!memberId) return '未指定'
  return props.team.roster.find((m) => m.memberId === memberId)?.name ?? '（已移除成员）'
}

// ---------- 节点 ----------

const showCp = ref(false)
const cpForm = ref({ name: '', counterBy: null as string | null })

function openCp() {
  cpForm.value = { name: '', counterBy: null }
  showCp.value = true
}

async function submitCp() {
  const f = cpForm.value
  if (!f.name.trim()) {
    message.error('请填写节点名称')
    return
  }
  await mutate((d) => {
    d.checkpoints.push({
      checkpointId: newId(),
      name: f.name.trim(),
      counterBy: f.counterBy,
      status: 'open',
      note: '',
    })
  })
  showCp.value = false
}

async function toggleCp(checkpointId: string) {
  await mutate((d) => {
    const cp = d.checkpoints.find((c) => c.checkpointId === checkpointId)
    if (cp) cp.status = cp.status === 'open' ? 'closed' : 'open'
  })
}

async function removeCp(checkpointId: string) {
  await mutate((d) => {
    d.checkpoints = d.checkpoints.filter((c) => c.checkpointId !== checkpointId)
  })
}
</script>

<template>
  <div class="wrap">
    <!-- 待审批 -->
    <n-card v-if="pendingJoins.length" title="待审批加入申请" size="small">
      <div v-for="j in pendingJoins" :key="j.joinRequestId" class="row join-row">
        <div class="grow">
          <strong>{{ j.memberName }}</strong>
          <span class="muted small"> 设备 {{ j.deviceId.slice(0, 6) }}…</span>
        </div>
        <n-select
          v-model:value="restoring[j.joinRequestId]"
          size="small"
          clearable
          placeholder="恢复为已有成员（可选）"
          :options="memberOptions"
          class="restore-select"
        />
        <n-button size="small" type="primary" @click="approve(j.joinRequestId)">
          <template #icon><Check :size="14" /></template>
          通过
        </n-button>
        <n-button size="small" @click="reject(j.joinRequestId)">
          <template #icon><X :size="14" /></template>
          拒绝
        </n-button>
      </div>
      <p class="muted small">
        对方没收到凭证（响应丢失/重启）时，选「恢复为已有成员」再通过，会保留原身份、撤销旧凭证。
      </p>
    </n-card>

    <!-- 名册 -->
    <n-card title="名册" size="small">
      <div class="chips">
        <n-tag v-for="m in team.roster" :key="m.memberId" size="small" :bordered="false">
          {{ m.name }}<span v-if="m.role === 'organizer'"> · 组织者</span>
        </n-tag>
      </div>
    </n-card>

    <!-- 物资与批次 -->
    <n-card title="物资与批次分工" size="small">
      <template #header-extra>
        <n-button size="small" @click="openItem">
          <template #icon><Plus :size="14" /></template>
          物资
        </n-button>
        <n-button size="small" @click="openAlloc()">
          <template #icon><Plus :size="14" /></template>
          批次
        </n-button>
      </template>

      <p v-if="team.items.length === 0" class="muted small">先添加物资需求，再拆批次指定谁买、谁带。</p>

      <div v-for="item in team.items" :key="item.itemId" class="item-block">
        <div class="row item-head">
          <strong>{{ item.name }}</strong>
          <span class="muted small">需 {{ item.qtyNeeded }} {{ item.unit }}</span>
          <n-popconfirm @positive-click="removeItem(item.itemId)">
            <template #trigger>
              <n-button size="tiny" quaternary>删除</n-button>
            </template>
            删除该物资会同时移除它的批次，确定？
          </n-popconfirm>
        </div>
        <div
          v-for="a in team.allocations.filter((x) => x.itemId === item.itemId)"
          :key="a.allocationId"
          class="row alloc-row"
        >
          <span class="muted small">批次 {{ a.allocationId.slice(0, 5) }}… · 计划 {{ a.qtyPlanned }} {{ item.unit }}</span>
          <n-tag size="tiny" :bordered="false">买：{{ memberName(a.purchaseBy) }}</n-tag>
          <n-tag size="tiny" :bordered="false">带：{{ memberName(a.carryBy) }}</n-tag>
          <n-popconfirm @positive-click="removeAlloc(a.allocationId)">
            <template #trigger>
              <n-button size="tiny" quaternary>删除</n-button>
            </template>
            删除这个批次？
          </n-popconfirm>
        </div>
      </div>
    </n-card>

    <!-- 节点 -->
    <n-card title="清点节点" size="small">
      <template #header-extra>
        <n-button size="small" @click="openCp">
          <template #icon><Plus :size="14" /></template>
          节点
        </n-button>
      </template>
      <p v-if="team.checkpoints.length === 0" class="muted small">
        节点是一次有范围的清点活动（出发前、集合点、营地…）。清点必须挂在节点上，不跨节点累加。
      </p>
      <div v-for="cp in team.checkpoints" :key="cp.checkpointId" class="row cp-row">
        <span class="grow">
          <strong>{{ cp.name }}</strong>
          <span class="muted small"> · 清点负责人：{{ memberName(cp.counterBy) }}</span>
        </span>
        <n-tag size="small" :type="cp.status === 'open' ? 'success' : 'default'" :bordered="false">
          {{ cp.status === 'open' ? '进行中' : '已关闭' }}
        </n-tag>
        <n-button size="tiny" @click="toggleCp(cp.checkpointId)">
          {{ cp.status === 'open' ? '关闭' : '重新打开' }}
        </n-button>
        <n-popconfirm @positive-click="removeCp(cp.checkpointId)">
          <template #trigger>
            <n-button size="tiny" quaternary>删除</n-button>
          </template>
          删除该节点？（已确认的清点记录会失去归属，建议只关闭不删除）
        </n-popconfirm>
      </div>
    </n-card>

    <!-- 添加物资 -->
    <n-modal v-model:show="showItem" preset="card" title="添加物资需求" style="width: min(460px, calc(100vw - 32px))">
      <n-form label-placement="top">
        <n-form-item label="名称">
          <n-input v-model:value="itemForm.name" placeholder="例如：矿泉水" />
        </n-form-item>
        <n-form-item label="分类">
          <n-select v-model:value="itemForm.category" :options="categoryOptions" />
        </n-form-item>
        <n-form-item label="需求数量（整数最小单位，如 1500 ml）">
          <n-input-number v-model:value="itemForm.qtyNeeded" :min="0" />
        </n-form-item>
        <n-form-item label="单位">
          <n-input v-model:value="itemForm.unit" placeholder="瓶 / ml / 个" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="foot">
          <n-button @click="showItem = false">取消</n-button>
          <n-button type="primary" @click="submitItem">添加</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 添加批次 -->
    <n-modal v-model:show="showAlloc" preset="card" title="添加批次分工" style="width: min(480px, calc(100vw - 32px))">
      <n-form label-placement="top">
        <n-form-item label="物资">
          <n-select
            v-model:value="allocForm.itemId"
            :options="team.items.map((i) => ({ label: i.name, value: i.itemId }))"
            placeholder="选择物资"
          />
        </n-form-item>
        <n-form-item label="计划数量">
          <n-input-number v-model:value="allocForm.qtyPlanned" :min="0" />
        </n-form-item>
        <n-form-item label="采购负责人">
          <n-select v-model:value="allocForm.purchaseBy" :options="memberOptions" clearable placeholder="谁去买" />
        </n-form-item>
        <n-form-item label="携带负责人">
          <n-select v-model:value="allocForm.carryBy" :options="memberOptions" clearable placeholder="谁来带" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="foot">
          <n-button @click="showAlloc = false">取消</n-button>
          <n-button type="primary" @click="submitAlloc">添加</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 添加节点 -->
    <n-modal v-model:show="showCp" preset="card" title="添加清点节点" style="width: min(460px, calc(100vw - 32px))">
      <n-form label-placement="top">
        <n-form-item label="节点名称">
          <n-input v-model:value="cpForm.name" placeholder="例如：集合点清点" />
        </n-form-item>
        <n-form-item label="清点负责人">
          <n-select v-model:value="cpForm.counterBy" :options="memberOptions" clearable placeholder="谁负责清点" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="foot">
          <n-button @click="showCp = false">取消</n-button>
          <n-button type="primary" @click="submitCp">添加</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.grow {
  flex: 1;
  min-width: 0;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.join-row {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--app-border);
}

.restore-select {
  min-width: 180px;
}

.item-block {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--app-border);
}

.item-head {
  margin-bottom: var(--space-2);
}

.alloc-row {
  padding-left: var(--space-4);
  padding-bottom: var(--space-1);
}

.cp-row {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--app-border);
}

.muted {
  color: var(--app-muted-soft);
}

.small {
  font-size: var(--text-xs);
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
