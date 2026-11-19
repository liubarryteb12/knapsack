<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import { useGoalsStore } from '../store'
import type { BoardRole, RoleTier } from '../schema'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const store = useGoalsStore()
const message = useMessage()

const visible = computed({
  get: () => props.show,
  set: (value: boolean) => emit('update:show', value),
})

const TIER_OPTIONS: Array<{ label: string; value: RoleTier }> = [
  { label: '主责', value: 'lead' },
  { label: '专职', value: 'specialist' },
  { label: '辅助', value: 'helper' },
]

const TIER_LABEL: Record<RoleTier, string> = {
  lead: '主责',
  specialist: '专职',
  helper: '辅助',
}

const editingId = ref('')
const form = ref({ name: '', tier: 'specialist' as RoleTier, charter: '', maxDoing: 2 })

watch(
  () => props.show,
  (open) => {
    if (open) resetForm()
  },
)

function resetForm() {
  editingId.value = ''
  form.value = { name: '', tier: 'specialist', charter: '', maxDoing: 2 }
}

function startEdit(role: BoardRole) {
  editingId.value = role.id
  form.value = {
    name: role.name,
    tier: role.tier,
    charter: role.charter,
    maxDoing: role.maxDoing,
  }
}

async function submit() {
  const name = form.value.name.trim()
  if (!name) {
    message.warning('先写人格名称')
    return
  }
  try {
    if (editingId.value) {
      await store.updateRole(editingId.value, {
        name,
        tier: form.value.tier,
        charter: form.value.charter.trim(),
        maxDoing: form.value.maxDoing,
      })
      message.success('人格已更新')
    } else {
      await store.createRole({
        name,
        tier: form.value.tier,
        charter: form.value.charter.trim(),
        maxDoing: form.value.maxDoing,
      })
      message.success('人格已创建')
    }
    resetForm()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function deactivate(role: BoardRole) {
  try {
    await store.deactivateRole(role.id)
    message.success(`「${role.name}」已停用（历史任务保留标记）`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const maxDoingOptions = [1, 2, 3, 4, 5].map((value) => ({
  label: `同时进行 ${value} 个`,
  value,
}))
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="管理人格" style="max-width: 560px">
    <p class="roles-note">
      人格是任务的执行角色。提示词库互通将在下一阶段接入，当前先用「职责说明」定义人格。
    </p>

    <div class="roles-list">
      <div v-for="role in store.roles" :key="role.id" class="roles-item" :class="{ 'roles-item-off': !role.active }">
        <div class="roles-item-main">
          <strong>{{ role.name }}</strong>
          <n-tag size="tiny" :bordered="false">{{ TIER_LABEL[role.tier] }}</n-tag>
          <n-tag size="tiny" :bordered="false">同时 {{ role.maxDoing }}</n-tag>
          <span v-if="!role.active" class="roles-item-off-label">已停用</span>
        </div>
        <p v-if="role.charter" class="roles-item-charter">{{ role.charter }}</p>
        <div v-if="role.active" class="roles-item-actions">
          <n-button size="tiny" @click="startEdit(role)">编辑</n-button>
          <n-button size="tiny" quaternary @click="deactivate(role)">停用</n-button>
        </div>
      </div>
      <p v-if="store.roles.length === 0" class="roles-empty">还没有人格。先建一个，例如「研究助手」。</p>
    </div>

    <div class="roles-form">
      <h4>{{ editingId ? '编辑人格' : '新建人格' }}</h4>
      <n-input v-model:value="form.name" size="small" placeholder="人格名称，例如：研究助手" />
      <n-input
        v-model:value="form.charter"
        size="small"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 4 }"
        placeholder="职责说明：这个人格接什么任务、怎么干。写得越具体，主理人分派越准。"
      />
      <div class="roles-form-row">
        <n-select v-model:value="form.tier" :options="TIER_OPTIONS" size="small" style="width: 120px" />
        <n-select v-model:value="form.maxDoing" :options="maxDoingOptions" size="small" style="width: 160px" />
        <span class="roles-form-space" />
        <n-button v-if="editingId" size="small" quaternary @click="resetForm">取消编辑</n-button>
        <n-button size="small" type="primary" @click="submit">
          {{ editingId ? '保存' : '创建' }}
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.roles-note {
  margin: 0 0 var(--space-3);
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.roles-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.roles-item {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
}

.roles-item-off {
  opacity: 0.55;
}

.roles-item-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.roles-item-off-label {
  color: var(--app-faint);
  font-size: var(--text-xs);
}

.roles-item-charter {
  margin: var(--space-1) 0 0;
  color: var(--app-muted);
  font-size: var(--text-xs);
}

.roles-item-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.roles-empty {
  color: var(--app-faint);
  font-size: var(--text-xs);
}

.roles-form {
  border-top: 1px solid var(--app-border);
  padding-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.roles-form h4 {
  margin: 0;
  font-size: var(--text-md);
}

.roles-form-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.roles-form-space {
  flex: 1;
}
</style>
