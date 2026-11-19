<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import { modRegistry } from '../../../core/bootMods'
import { WORK_PROMPT_CATALOG_TOPIC, type WorkPromptProjection } from '../../../core/capabilityContracts'
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

// ---------- 提示词库人格目录（capability 只读；模块关闭时为空） ----------

const catalog = ref<WorkPromptProjection[]>([])
const catalogLoading = ref(false)
const importPromptId = ref('')

watch(
  () => props.show,
  async (open) => {
    if (open) {
      resetForm()
      await loadCatalog()
    }
  },
)

async function loadCatalog() {
  catalogLoading.value = true
  try {
    const values = await modRegistry.capabilities.query<WorkPromptProjection[]>(
      WORK_PROMPT_CATALOG_TOPIC,
    )
    catalog.value = values.flat()
  } catch {
    catalog.value = []
  } finally {
    catalogLoading.value = false
  }
}

const catalogOptions = computed(() =>
  catalog.value.map((item) => ({ label: item.title, value: item.id })),
)

/** 从提示词库导入人格：标题作名称、systemRole 摘要作 charter 初稿 */
async function importFromCatalog() {
  const item = catalog.value.find((row) => row.id === importPromptId.value)
  if (!item) return
  const name = item.title.trim().slice(0, 40)
  const charter = (item.systemRole.trim() || item.templateBody.trim()).slice(0, 200)
  try {
    await store.createRole({
      name,
      charter,
      promptId: item.id,
      promptTitle: item.title,
    })
    message.success(`已导入人格「${name}」`)
    importPromptId.value = ''
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const editingId = ref('')
const form = ref({ name: '', tier: 'specialist' as RoleTier, charter: '', maxDoing: 2 })

function resetForm() {
  editingId.value = ''
  form.value = { name: '', tier: 'specialist', charter: '', maxDoing: 2 }
}

function charterOf(role: BoardRole): string {
  return role.charter
}

function isOrphaned(role: BoardRole): boolean {
  return !!role.promptId && !catalog.value.some((item) => item.id === role.promptId)
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
      人格是任务的执行角色。可从提示词库导入（一个 WORK_LLM 条目 = 一个人格），或直接手写职责说明。
    </p>

    <div v-if="catalogOptions.length > 0 || catalogLoading" class="roles-import">
      <n-select
        v-model:value="importPromptId"
        :options="catalogOptions"
        :loading="catalogLoading"
        size="small"
        placeholder="从提示词库选择一个「干工作」条目…"
        filterable
      />
      <n-button size="small" :disabled="!importPromptId" @click="importFromCatalog">导入为人格</n-button>
    </div>
    <p v-else class="roles-import-empty">提示词库还没有「干工作」条目（或模块已关闭），可以先手写人格。</p>

    <div class="roles-list">
      <div v-for="role in store.roles" :key="role.id" class="roles-item" :class="{ 'roles-item-off': !role.active }">
        <div class="roles-item-main">
          <strong>{{ role.name }}</strong>
          <n-tag size="tiny" :bordered="false">{{ TIER_LABEL[role.tier] }}</n-tag>
          <n-tag size="tiny" :bordered="false">同时 {{ role.maxDoing }}</n-tag>
          <n-tag v-if="role.promptId && !isOrphaned(role)" size="tiny" type="info" :bordered="false">来自提示词库</n-tag>
          <span v-if="isOrphaned(role)" class="roles-item-warning">提示词已失效，按职责说明兜底</span>
          <span v-if="!role.active" class="roles-item-off-label">已停用</span>
        </div>
        <p v-if="charterOf(role)" class="roles-item-charter">{{ charterOf(role) }}</p>
        <div v-if="role.active" class="roles-item-actions">
          <n-button size="tiny" @click="startEdit(role)">编辑</n-button>
          <n-button size="tiny" quaternary @click="deactivate(role)">停用</n-button>
        </div>
      </div>
      <p v-if="store.roles.length === 0" class="roles-empty">还没有人格。从提示词库导入，或手写一个。</p>
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

.roles-import {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.roles-import-empty {
  margin: 0 0 var(--space-3);
  color: var(--app-faint);
  font-size: var(--text-xs);
}

.roles-item-warning {
  color: var(--app-warning);
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
