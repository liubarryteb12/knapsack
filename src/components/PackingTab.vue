<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NButton, NModal, NInput, NCheckbox,
  NProgress, NEmpty, NDropdown, NPopconfirm,
} from 'naive-ui'
import type { Trip, PackingGroup } from '../schema/trip'
import { nanoid } from 'nanoid'
import { useTripsStore } from '../stores/trips'
import { packingTemplates } from './packingTemplates'

const props = defineProps<{ trip: Trip }>()
const tripsStore = useTripsStore()

// ---- 进度 ----
const totalItems = computed(() => props.trip.packing.reduce((a, g) => a + g.items.length, 0))
const packedItems = computed(() =>
  props.trip.packing.reduce((a, g) => a + g.items.filter((i) => i.packed).length, 0),
)
const packedPct = computed(() =>
  totalItems.value === 0 ? 0 : Math.round((packedItems.value / totalItems.value) * 100),
)

// ---- 模板 ----
const showTemplates = ref(false)

async function applyTemplate(destType: keyof typeof packingTemplates) {
  const template = packingTemplates[destType]
  for (const tplGroup of template.groups) {
    // 已有同名分组则跳过，避免重复追加
    if (props.trip.packing.some((g) => g.group === tplGroup.group)) continue
    const group: PackingGroup = {
      group: tplGroup.group,
      items: tplGroup.items.map((label) => ({ id: nanoid(8), label, packed: false })),
    }
    props.trip.packing.push(group)
  }
  await tripsStore.saveTrip(props.trip)
  showTemplates.value = false
}

// ---- 自定义分组/条目 ----
const newGroupName = ref('')
const addingItemGroup = ref<number | null>(null)
const newItemLabel = ref('')

async function addGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  if (props.trip.packing.some((g) => g.group === name)) {
    window.alert('已有同名分组')
    return
  }
  props.trip.packing.push({ group: name, items: [] })
  newGroupName.value = ''
  await tripsStore.saveTrip(props.trip)
}

async function renameGroup(gi: number) {
  const g = props.trip.packing[gi]
  if (!g) return
  const name = window.prompt('新分组名', g.group)
  if (!name?.trim()) return
  g.group = name.trim()
  await tripsStore.saveTrip(props.trip)
}

async function removeGroup(gi: number) {
  props.trip.packing.splice(gi, 1)
  await tripsStore.saveTrip(props.trip)
}

async function addItem(gi: number) {
  const label = newItemLabel.value.trim()
  if (!label) return
  const g = props.trip.packing[gi]
  if (!g) return
  g.items.push({ id: nanoid(8), label, packed: false })
  newItemLabel.value = ''
  addingItemGroup.value = null
  await tripsStore.saveTrip(props.trip)
}

async function toggleItem(item: { packed: boolean }) {
  item.packed = !item.packed
  await tripsStore.saveTrip(props.trip)
}

async function removeItem(gi: number, ii: number) {
  const g = props.trip.packing[gi]
  if (!g) return
  g.items.splice(ii, 1)
  await tripsStore.saveTrip(props.trip)
}

const groupActions = [
  { label: '重命名', key: 'rename' },
  { label: '删除分组', key: 'delete' },
]

async function onGroupAction(key: string, gi: number) {
  if (key === 'rename') await renameGroup(gi)
  else if (key === 'delete') await removeGroup(gi)
}
</script>

<template>
  <div class="packing">
    <div class="packing-toolbar">
      <div class="progress-line">
        <n-progress
          type="line"
          :percentage="packedPct"
          :show-indicator="false"
          :height="10"
          :border-radius="5"
          color="#16a34a"
        />
        <span class="progress-text">{{ packedItems }}/{{ totalItems }} 已打包（{{ packedPct }}%）</span>
      </div>
      <n-button size="small" type="primary" @click="showTemplates = true">套用模板</n-button>
    </div>

    <n-empty v-if="trip.packing.length === 0" description="行李清单是空的，套个模板快速开始" class="empty">
      <template #extra>
        <n-button type="primary" @click="showTemplates = true">套用模板</n-button>
      </template>
    </n-empty>

    <div class="groups">
      <div v-for="(g, gi) in trip.packing" :key="g.group" class="group-card">
        <div class="group-header">
          <strong>{{ g.group }}</strong>
          <span class="muted small">{{ g.items.filter((i) => i.packed).length }}/{{ g.items.length }}</span>
          <n-dropdown trigger="click" :options="groupActions" @select="(key: string) => onGroupAction(key, gi)">
            <n-button size="tiny" quaternary>⋯</n-button>
          </n-dropdown>
        </div>
        <div class="group-items">
          <div v-for="(item, ii) in g.items" :key="item.id" class="packing-item">
            <n-checkbox :checked="item.packed" @update:checked="() => toggleItem(item)">
              <span :class="{ packed: item.packed }">{{ item.label }}</span>
            </n-checkbox>
            <n-popconfirm @positive-click="removeItem(gi, ii)">
              <template #trigger>
                <n-button size="tiny" quaternary type="error">×</n-button>
              </template>
              删除「{{ item.label }}」？
            </n-popconfirm>
          </div>
          <div v-if="addingItemGroup === gi" class="add-item-row">
            <n-input v-model:value="newItemLabel" size="small" placeholder="物品名" @keyup.enter="addItem(gi)" />
            <n-button size="small" type="primary" @click="addItem(gi)">加</n-button>
          </div>
        </div>
        <n-button v-if="addingItemGroup !== gi" size="tiny" quaternary @click="addingItemGroup = gi; newItemLabel = ''">
          + 加东西
        </n-button>
      </div>
    </div>

    <div class="add-group">
      <n-input v-model:value="newGroupName" size="small" placeholder="新分组名，例如：药品" @keyup.enter="addGroup" />
      <n-button size="small" @click="addGroup">添加分组</n-button>
    </div>

    <n-modal v-model:show="showTemplates" preset="card" title="套用行李模板" style="width: 420px">
      <p class="muted small">套用 = 追加分组（已有同名分组会跳过）。</p>
      <div class="template-grid">
        <n-button v-for="(tpl, key) in packingTemplates" :key="key" @click="applyTemplate(key)">
          {{ tpl.icon }} {{ tpl.label }}
        </n-button>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.packing {
  padding-top: 12px;
}

.packing-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.progress-line {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-text {
  font-size: 13px;
  color: #6b7280;
  white-space: nowrap;
}

.empty {
  margin: 60px 0;
}

.groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.group-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.group-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}

.packing-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.packed {
  text-decoration: line-through;
  color: #9ca3af;
}

.add-item-row {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.add-group {
  display: flex;
  gap: 8px;
  max-width: 320px;
}

.template-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}

.muted {
  color: #9ca3af;
}

.small {
  font-size: 12px;
}
</style>
