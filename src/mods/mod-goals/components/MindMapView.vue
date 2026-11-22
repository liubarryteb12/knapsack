<script setup lang="ts">
/**
 * 目标思维导图栏目。
 *
 * 两种模式：
 * - 单目标聚焦（默认）：选中一个目标，画「目标 → 里程碑 → 任务」的完整结构；
 * - 多目标合成：勾选多个目标，合成一张总览图。
 *
 * 交互：折叠/展开、缩放、拖拽平移、适配画布；
 * 导出：Markdown / OPML（dsh-mindmap 可直接导入）、SVG、PNG。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NInput,
  NPopconfirm,
  NSelect,
  NSwitch,
  useMessage,
} from 'naive-ui'
import { Copy, Download, Image as ImageIcon, Maximize2, Minus, Plus, Target } from '@lucide/vue'
import UiEmptyState from '../../../components/ui/UiEmptyState.vue'
import { saveBinaryFile, saveTextFile } from '../../../utils/fileBridge'
import { useGoalsStore } from '../store'
import {
  buildMindmap,
  countMindNodes,
  mindmapFilename,
  toMindmapMarkdown,
  toMindmapOpml,
  type MindNode,
} from '../services/mindmapTree'
import {
  FONT_SIZE,
  MindmapTooLargeError,
  branchColor,
  checkPos,
  edgePath,
  layoutMindmap,
  mindmapToSvg,
  rgba,
  svgToPngBlob,
  taperPath,
  textPos,
  tickPath,
  togglePos,
  type Measure,
  type MindmapLayoutNode,
  type MindmapMode,
} from '../services/mindmapLayout'
import { loadSampleGoals } from '../services/sampleGoalPack'

const props = defineProps<{
  /** 从目标卡片跳进来时指定的目标 */
  initialGoalId?: string
}>()

const emit = defineEmits<{
  'goal-change': [goalId: string]
}>()

const store = useGoalsStore()
const message = useMessage()

const GOAL_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  active: '进行中',
  paused: '暂停',
  done: '已完成',
  abandoned: '已放弃',
}

const layoutOptions = [
  { label: '双向平衡', value: 'both' },
  { label: '向右生长', value: 'right' },
]

const modeOptions = [
  { label: '单个目标', value: 'single' },
  { label: '多目标合成', value: 'multi' },
]

// ---------- 模式与目标选择 ----------

const mode = ref<'single' | 'multi'>('single')
const focusGoalId = ref<string>(props.initialGoalId ?? '')
const excluded = ref<Set<string>>(new Set())

const allGoalIds = computed(() => store.goalsSorted.map((goal) => goal.id))

watch(allGoalIds, (ids) => {
  if (mode.value !== 'single') return
  if (!focusGoalId.value || !ids.includes(focusGoalId.value)) {
    focusGoalId.value = ids[0] ?? ''
  }
}, { immediate: true })

watch(
  () => props.initialGoalId,
  (id) => {
    if (!id) return
    mode.value = 'single'
    focusGoalId.value = id
  },
)

const goalOptions = computed(() =>
  store.goalsSorted.map((goal) => ({
    label: `${goal.title}（${GOAL_STATUS_LABEL[goal.status]}）`,
    value: goal.id,
  })),
)

const focusGoal = computed(() => store.goalById(focusGoalId.value))

const selectedGoalIds = computed<string[]>({
  get: () => allGoalIds.value.filter((id) => !excluded.value.has(id)),
  set: (ids) => {
    const keep = new Set(ids)
    excluded.value = new Set(allGoalIds.value.filter((id) => !keep.has(id)))
  },
})

function selectAll() {
  excluded.value = new Set()
}

function selectActive() {
  const active = new Set(store.goals.filter((goal) => goal.status === 'active').map((goal) => goal.id))
  excluded.value = new Set(allGoalIds.value.filter((id) => !active.has(id)))
}

function selectNone() {
  excluded.value = new Set(allGoalIds.value)
}

function onFocusChange(value: string) {
  emit('goal-change', value)
}

// ---------- 导图数据 ----------

const multiTitle = ref('我的目标')
const includeTasks = ref(true)
const layoutMode = ref<MindmapMode>('both')
const collapsedIds = ref<Set<string>>(new Set())

const tree = computed<MindNode>(() => {
  if (mode.value === 'single') {
    return buildMindmap({
      goals: store.goalsSorted,
      milestones: store.milestones,
      tasks: store.tasks,
      focusGoalId: focusGoalId.value,
      includeTasks: includeTasks.value,
    })
  }
  return buildMindmap({
    goals: store.goalsSorted,
    milestones: store.milestones,
    tasks: store.tasks,
    selectedGoalIds: new Set(selectedGoalIds.value),
    title: multiTitle.value,
    includeTasks: includeTasks.value,
  })
})

const nodeCount = computed(() => countMindNodes(tree.value))
const hasContent = computed(() =>
  mode.value === 'single' ? Boolean(focusGoal.value) : selectedGoalIds.value.length > 0,
)

// ---------- 文字测量与配色 ----------

const scrollEl = ref<HTMLElement | null>(null)
const measureVersion = ref(0)
const fontFamily = ref('system-ui, -apple-system, "Segoe UI", sans-serif')

let measureText: Measure = (text, bold, size = FONT_SIZE) =>
  (text.length * (bold ? 9 : 8) * size) / FONT_SIZE
const measureCache = new Map<string, number>()

function setupMeasure() {
  if (typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const family = getComputedStyle(document.body).fontFamily
  if (family) fontFamily.value = family
  if (!ctx) return
  measureText = (text, bold, size = FONT_SIZE) => {
    const key = `${bold ? 'b' : 'n'}${size}|${text}`
    const hit = measureCache.get(key)
    if (hit !== undefined) return hit
    ctx.font = `${bold ? '600 ' : ''}${size}px ${fontFamily.value}`
    const width = ctx.measureText(text).width
    if (measureCache.size > 20000) measureCache.clear()
    measureCache.set(key, width)
    return width
  }
  measureVersion.value++
}

interface Palette {
  text: string
  sub: string
  card: string
  bg: string
  accent: string
  dark: boolean
}

const palette = ref<Palette>({
  text: '#1f2937',
  sub: '#6b7280',
  card: '#ffffff',
  bg: '#ffffff',
  accent: '#4f46e5',
  dark: false,
})

function readPalette() {
  const el = scrollEl.value ?? document.body
  if (!el) return
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback
  palette.value = {
    text: v('--app-text', '#1f2937'),
    sub: v('--app-text-secondary', '#6b7280'),
    card: v('--app-bg-soft', '#ffffff'),
    bg: v('--app-bg', '#ffffff'),
    accent: v('--app-accent-solid', '#4f46e5'),
    dark: document.documentElement.dataset.theme === 'dark',
  }
}

// ---------- 布局 ----------

const layout = computed(() => {
  measureVersion.value
  return layoutMindmap(tree.value, measureText, {
    mode: layoutMode.value,
    collapsed: collapsedIds.value,
  })
})

const svgWidth = computed(() => Math.max(1, Math.ceil(layout.value.width)))
const svgHeight = computed(() => Math.max(1, Math.ceil(layout.value.height)))

const zoom = ref(1)
const displayWidth = computed(() => svgWidth.value * zoom.value)
const displayHeight = computed(() => svgHeight.value * zoom.value)
const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`)

function setZoom(next: number) {
  const clamped = Math.min(3, Math.max(0.2, next))
  const el = scrollEl.value
  if (!el) {
    zoom.value = clamped
    return
  }
  const ratioX = el.scrollLeft / Math.max(1, el.scrollWidth)
  const ratioY = el.scrollTop / Math.max(1, el.scrollHeight)
  zoom.value = clamped
  void nextTick(() => {
    el.scrollLeft = ratioX * el.scrollWidth
    el.scrollTop = ratioY * el.scrollHeight
  })
}

function fit() {
  const el = scrollEl.value
  if (!el || el.clientWidth === 0) return
  const pad = 32
  const scale = Math.min(
    (el.clientWidth - pad) / svgWidth.value,
    (el.clientHeight - pad) / svgHeight.value,
    1,
  )
  zoom.value = Math.max(0.35, Math.min(1, scale))
  void nextTick(() => {
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
    el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
  })
}

function onWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  setZoom(zoom.value * (event.deltaY < 0 ? 1.1 : 0.9))
}

// ---------- 拖拽平移 ----------

let drag: { x: number; y: number; left: number; top: number } | null = null

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as Element | null
  if (target?.closest('.mm-node')) return
  const el = scrollEl.value
  if (!el) return
  drag = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
  el.classList.add('is-panning')
  el.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!drag || !scrollEl.value) return
  const el = scrollEl.value
  el.scrollLeft = drag.left - (event.clientX - drag.x)
  el.scrollTop = drag.top - (event.clientY - drag.y)
}

function endDrag() {
  drag = null
  scrollEl.value?.classList.remove('is-panning')
}

// ---------- 折叠 ----------

function toggleNode(node: MindmapLayoutNode) {
  if (!node.hasKids) return
  const next = new Set(collapsedIds.value)
  if (next.has(node.id)) next.delete(node.id)
  else next.add(node.id)
  collapsedIds.value = next
}

function onNodeKeydown(event: KeyboardEvent, node: MindmapLayoutNode) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  toggleNode(node)
}

function expandAll() {
  collapsedIds.value = new Set()
}

function collapseTasks() {
  const next = new Set<string>()
  for (const milestone of store.milestones) {
    if (store.tasksOf(milestone.id).length > 0) next.add(milestone.id)
  }
  collapsedIds.value = next
}

// ---------- 渲染数据 ----------

interface RenderEdge {
  id: string
  d: string
  fill: string
  stroke: string
  width: number
}

const edges = computed<RenderEdge[]>(() => {
  const out: RenderEdge[] = []
  const dark = palette.value.dark
  for (const node of layout.value.nodes) {
    if (!node.parent) continue
    const parent = layout.value.byId.get(node.parent)
    if (!parent) continue
    const color = branchColor(node.branch, dark)
    if (node.depth === 1) {
      out.push({ id: node.id, d: taperPath(parent, node), fill: color, stroke: 'none', width: 0 })
    } else {
      out.push({ id: node.id, d: edgePath(parent, node), fill: 'none', stroke: color, width: 1.5 })
    }
  }
  return out
})

function nodeFill(node: MindmapLayoutNode): string {
  if (node.depth === 0) return palette.value.accent
  const color = branchColor(node.branch, palette.value.dark)
  if (node.depth === 1) return rgba(color, palette.value.dark ? 0.2 : 0.1)
  return palette.value.card
}

function nodeStroke(node: MindmapLayoutNode): string {
  if (node.depth === 0) return 'none'
  return branchColor(node.branch, palette.value.dark)
}

function nodeStrokeWidth(node: MindmapLayoutNode): number {
  if (node.depth === 0) return 0
  return node.depth === 1 ? 1.5 : 1
}

function nodeStrokeOpacity(node: MindmapLayoutNode): number {
  if (node.depth === 0) return 0
  return node.depth === 1 ? 1 : 0.55
}

function textColor(node: MindmapLayoutNode): string {
  if (node.depth === 0) return '#ffffff'
  if (node.checked === true) return palette.value.sub
  return palette.value.text
}

function nodeRadius(node: MindmapLayoutNode): number {
  return node.depth === 0 ? 8 : 6
}

// ---------- 导出 ----------

/** 文件名带目标标识：单目标用标题，多目标用日期 */
function baseFilename(): string {
  if (mode.value === 'single' && focusGoal.value) {
    const safe = focusGoal.value.title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)
    return `knapsack-mindmap-${safe}`
  }
  return mindmapFilename('').replace(/\.$/, '')
}

function svgPayload() {
  return mindmapToSvg(layout.value, {
    text: palette.value.text,
    sub: palette.value.sub,
    card: palette.value.card,
    bg: palette.value.bg,
    accent: palette.value.accent,
    dark: palette.value.dark,
    font: fontFamily.value,
  })
}

async function saveText(filename: string, text: string, mime: string, label: string) {
  const result = await saveTextFile(filename, text, mime)
  if (!result.ok) {
    if (!result.cancelled) message.error(result.error ?? `${label} 导出失败`)
    return
  }
  if (result.warning) message.warning(`${label} 已保存（分享未完成：${result.warning}）`)
  else message.success(`${label} 已导出：${filename}`)
}

async function exportMarkdown() {
  try {
    await saveText(`${baseFilename()}.md`, toMindmapMarkdown(tree.value), 'text/markdown', 'Markdown')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function exportOpml() {
  try {
    await saveText(`${baseFilename()}.opml`, toMindmapOpml(tree.value), 'text/xml', 'OPML')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function exportSvg() {
  try {
    const { svg } = svgPayload()
    await saveText(
      `${baseFilename()}.svg`,
      `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`,
      'image/svg+xml',
      'SVG',
    )
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const exportingPng = ref(false)

async function exportPng() {
  exportingPng.value = true
  try {
    const { svg, width, height } = svgPayload()
    const blob = await svgToPngBlob(svg, width, height, 2)
    const filename = `${baseFilename()}.png`
    const result = await saveBinaryFile(filename, blob, 'image/png')
    if (!result.ok) {
      if (!result.cancelled) message.error(result.error ?? 'PNG 导出失败')
    } else if (result.warning) message.warning(`PNG 已保存（分享未完成：${result.warning}）`)
    else message.success(`PNG 已导出：${filename}`)
  } catch (error) {
    if (error instanceof MindmapTooLargeError) message.warning(error.message)
    else message.error(error instanceof Error ? error.message : String(error))
  } finally {
    exportingPng.value = false
  }
}

async function copyMarkdown() {
  const text = toMindmapMarkdown(tree.value)
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制 Markdown，可直接粘贴到思维导图工具')
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    if (ok) message.success('已复制 Markdown')
    else message.error('复制失败，请改用「导出 Markdown」')
  }
}

// ---------- 示例目标 ----------

const loadingSample = ref(false)

async function loadSample() {
  loadingSample.value = true
  try {
    const plan = await loadSampleGoals()
    await store.loadAll()
    message.success(`示例目标已载入：新增 ${plan.counts.goals.create} 个目标`)
    const first = store.goalsSorted.find((goal) =>
      goal.externalId?.startsWith('sample-'),
    )
    if (first) {
      focusGoalId.value = first.id
      mode.value = 'single'
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    loadingSample.value = false
  }
}

// ---------- 生命周期 ----------

let themeObserver: MutationObserver | null = null
let visibilityObserver: IntersectionObserver | null = null
let fitted = false

/**
 * 首次可见时自动适配画布。
 * 数据是异步加载的，挂载瞬间画布可能还不存在，所以同时监听元素与布局尺寸。
 */
watch(
  () => [scrollEl.value, layout.value.width] as const,
  () => {
    if (fitted) return
    const el = scrollEl.value
    if (!el || el.clientWidth === 0) return
    fitted = true
    void nextTick(fit)
  },
  { flush: 'post' },
)

/** 切换目标后重新适配（不复用旧的缩放） */
watch([mode, focusGoalId, () => layoutMode.value], () => {
  fitted = false
  void nextTick(() => {
    const el = scrollEl.value
    if (el && el.clientWidth > 0) {
      fitted = true
      fit()
    }
  })
})

onMounted(() => {
  setupMeasure()
  readPalette()
  themeObserver = new MutationObserver(readPalette)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  scrollEl.value?.addEventListener('wheel', onWheel, { passive: false })
  if (scrollEl.value) {
    // 标签页隐藏时画布宽度为 0，切到本栏目后再适配一次
    visibilityObserver = new IntersectionObserver((entries) => {
      if (fitted) return
      const entry = entries[0]
      if (entry?.isIntersecting && (scrollEl.value?.clientWidth ?? 0) > 0) {
        fitted = true
        requestAnimationFrame(() => fit())
      }
    })
    visibilityObserver.observe(scrollEl.value)
  }
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  visibilityObserver?.disconnect()
  scrollEl.value?.removeEventListener('wheel', onWheel)
})
</script>

<template>
  <div class="mm-shell">
    <aside class="mm-side">
      <div class="mm-side-block">
        <div class="mm-side-title">
          <span>视图模式</span>
          <n-popconfirm @positive-click="loadSample">
            <template #trigger>
              <n-button text size="tiny" :loading="loadingSample">载入示例</n-button>
            </template>
            会写入 3 个示例目标（含里程碑与任务），可随时删除；重复载入按外部 ID 更新，不会重复创建。确认载入？
          </n-popconfirm>
        </div>
        <n-select v-model:value="mode" size="small" :options="modeOptions" />

        <template v-if="mode === 'single'">
          <div class="mm-side-title mm-side-title-gap">
            <span>选择目标</span>
          </div>
          <div v-if="store.goalsSorted.length === 0" class="mm-side-empty">还没有目标</div>
          <n-select
            v-else
            v-model:value="focusGoalId"
            size="small"
            :options="goalOptions"
            @update:value="onFocusChange"
          />
          <div v-if="focusGoal" class="mm-focus-meta">
            <span>{{ GOAL_STATUS_LABEL[focusGoal.status] }} · P{{ focusGoal.priority }}</span>
            <span v-if="focusGoal.targetDate">截止 {{ focusGoal.targetDate }}</span>
            <span>{{ store.milestonesOf(focusGoal.id).length }} 里程碑</span>
          </div>
        </template>

        <template v-else>
          <div class="mm-side-title mm-side-title-gap">
            <span>目标清单</span>
            <span class="mm-side-count">{{ selectedGoalIds.length }}/{{ allGoalIds.length }}</span>
          </div>
          <div class="mm-select-actions">
            <n-button text size="tiny" @click="selectAll">全选</n-button>
            <n-button text size="tiny" @click="selectActive">仅进行中</n-button>
            <n-button text size="tiny" @click="selectNone">全不选</n-button>
          </div>
          <div v-if="allGoalIds.length === 0" class="mm-side-empty">还没有目标</div>
          <n-checkbox-group v-else v-model:value="selectedGoalIds" class="mm-goal-list">
            <div v-for="goal in store.goalsSorted" :key="goal.id" class="mm-goal">
              <n-checkbox :value="goal.id">
                <span class="mm-goal-title">{{ goal.title }}</span>
                <span class="mm-goal-meta">
                  {{ GOAL_STATUS_LABEL[goal.status] }} · P{{ goal.priority }}
                  <template v-if="goal.targetDate"> · {{ goal.targetDate }}</template>
                </span>
              </n-checkbox>
            </div>
          </n-checkbox-group>
        </template>
      </div>

      <div class="mm-side-block">
        <div class="mm-side-title"><span>导图选项</span></div>
        <label v-if="mode === 'multi'" class="mm-option">
          <span>根节点</span>
          <n-input v-model:value="multiTitle" size="small" placeholder="我的目标" />
        </label>
        <label class="mm-option">
          <span>包含任务</span>
          <n-switch v-model:value="includeTasks" size="small" />
        </label>
        <label class="mm-option">
          <span>布局</span>
          <n-select v-model:value="layoutMode" size="small" :options="layoutOptions" />
        </label>
      </div>

      <div class="mm-side-block mm-export">
        <div class="mm-side-title"><span>导出</span></div>
        <div class="mm-export-hint">
          图片给文档和微信；Markdown / OPML 可导入 dsh-mindmap 继续编辑。
        </div>
        <div class="mm-export-grid">
          <n-button size="small" :loading="exportingPng" @click="exportPng">
            <template #icon><ImageIcon :size="14" /></template>
            PNG
          </n-button>
          <n-button size="small" @click="exportSvg">
            <template #icon><Download :size="14" /></template>
            SVG
          </n-button>
          <n-button size="small" @click="copyMarkdown">
            <template #icon><Copy :size="14" /></template>
            复制
          </n-button>
          <n-button size="small" @click="exportMarkdown">
            <template #icon><Download :size="14" /></template>
            Markdown
          </n-button>
          <n-button size="small" @click="exportOpml">
            <template #icon><Download :size="14" /></template>
            OPML
          </n-button>
        </div>
      </div>
    </aside>

    <section class="mm-stage">
      <div class="mm-toolbar">
        <div class="mm-toolbar-left">
          <span class="mm-stat">
            <template v-if="mode === 'single' && focusGoal">{{ focusGoal.title }} · </template>
            {{ nodeCount }} 个节点
          </span>
        </div>
        <div class="mm-toolbar-right">
          <n-button quaternary size="tiny" title="缩小" @click="setZoom(zoom * 0.9)">
            <template #icon><Minus :size="14" /></template>
          </n-button>
          <span class="mm-zoom">{{ zoomPercent }}</span>
          <n-button quaternary size="tiny" title="放大" @click="setZoom(zoom * 1.1)">
            <template #icon><Plus :size="14" /></template>
          </n-button>
          <n-button quaternary size="tiny" title="适配画布" @click="fit">
            <template #icon><Maximize2 :size="14" /></template>
          </n-button>
          <n-button quaternary size="tiny" @click="expandAll">展开全部</n-button>
          <n-button quaternary size="tiny" @click="collapseTasks">收起任务</n-button>
        </div>
      </div>

      <div v-if="!hasContent" class="mm-stage-empty">
        <UiEmptyState
          :icon="Target"
          title="还没有可展示的目标"
          :description="
            store.goalsSorted.length === 0
              ? '新建一个目标并拆出里程碑，导图会自动生成；也可以先载入三个结构完整的示例目标看看效果。'
              : '在左侧勾选至少一个目标，导图会自动生成。'
          "
        >
          <n-popconfirm v-if="store.goalsSorted.length === 0" @positive-click="loadSample">
            <template #trigger>
              <n-button type="primary" :loading="loadingSample">载入示例目标</n-button>
            </template>
            会写入 3 个示例目标（含里程碑与任务），可随时删除。确认载入？
          </n-popconfirm>
          <n-button v-else type="primary" @click="selectAll">全选目标</n-button>
        </UiEmptyState>
      </div>

      <div
        v-else
        ref="scrollEl"
        class="mm-scroll"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @pointerleave="endDrag"
      >
        <svg
          class="mm-svg"
          :width="displayWidth"
          :height="displayHeight"
          :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
          :font-family="fontFamily"
        >
          <g>
            <path
              v-for="edge in edges"
              :key="edge.id"
              :d="edge.d"
              :fill="edge.fill"
              :stroke="edge.stroke"
              :stroke-width="edge.width"
            />
          </g>
          <g
            v-for="node in layout.nodes"
            :key="node.id"
            class="mm-node"
            :class="{ 'mm-node-clickable': node.hasKids }"
            :role="node.hasKids ? 'button' : undefined"
            :tabindex="node.hasKids ? 0 : undefined"
            :aria-label="node.hasKids ? `${node.text}（回车折叠/展开）` : undefined"
            @click="toggleNode(node)"
            @keydown="onNodeKeydown($event, node)"
          >
            <title>{{ node.full }}{{ node.collapsed ? `（已折叠 ${node.hidden} 项）` : '' }}</title>
            <rect
              :x="node.x"
              :y="node.y"
              :width="node.w"
              :height="node.h"
              :rx="nodeRadius(node)"
              :fill="nodeFill(node)"
              :stroke="nodeStroke(node)"
              :stroke-width="nodeStrokeWidth(node)"
              :stroke-opacity="nodeStrokeOpacity(node)"
            />
            <template v-if="node.checked !== null">
              <rect
                :x="checkPos(node).x"
                :y="checkPos(node).y"
                width="12"
                height="12"
                rx="3"
                :fill="node.checked ? branchColor(node.branch, palette.dark) : 'none'"
                :stroke="node.checked ? 'none' : palette.sub"
              />
              <path
                v-if="node.checked"
                :d="tickPath(checkPos(node).x, checkPos(node).y)"
                fill="none"
                stroke="#ffffff"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </template>
            <text
              v-for="(line, index) in node.lines"
              :key="index"
              :x="textPos(node, index).x"
              :y="textPos(node, index).y"
              :font-size="node.fs"
              :font-weight="node.depth === 0 ? 600 : 400"
              dominant-baseline="central"
              :fill="textColor(node)"
              :text-decoration="node.checked === true ? 'line-through' : 'none'"
              xml:space="preserve"
            >{{ line }}</text>
            <template v-if="node.collapsed">
              <circle
                :cx="togglePos(node).cx"
                :cy="togglePos(node).cy"
                r="8"
                :fill="palette.card"
                :stroke="branchColor(node.branch, palette.dark)"
              />
              <text
                :x="togglePos(node).cx"
                :y="togglePos(node).cy"
                font-size="10"
                text-anchor="middle"
                dominant-baseline="central"
                :fill="palette.sub"
              >{{ node.hidden > 99 ? '99+' : node.hidden }}</text>
            </template>
          </g>
        </svg>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mm-shell {
  display: flex;
  gap: var(--space-4);
  min-height: 540px;
  height: calc(100vh - 260px);
}

.mm-side {
  width: 260px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow-y: auto;
  padding-right: var(--space-1);
}

.mm-side-block {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-bg-soft);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mm-side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--app-text);
}

.mm-side-title-gap {
  margin-top: var(--space-1);
}

.mm-side-count {
  font-weight: 400;
  font-size: var(--text-xs);
  color: var(--app-text-secondary);
}

.mm-select-actions {
  display: flex;
  gap: var(--space-3);
}

.mm-side-empty {
  font-size: var(--text-xs);
  color: var(--app-text-secondary);
}

.mm-focus-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--app-text-secondary);
}

.mm-goal-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 150px;
  overflow-y: auto;
}

.mm-goal :deep(.n-checkbox__label) {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.35;
}

.mm-goal-title {
  font-size: var(--text-sm);
  color: var(--app-text);
}

.mm-goal-meta {
  font-size: var(--text-xs);
  color: var(--app-text-secondary);
}

.mm-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--app-text-secondary);
}

.mm-option > :last-child {
  flex: 1;
  max-width: 150px;
}

.mm-export {
  gap: var(--space-2);
}

.mm-export-hint {
  font-size: var(--text-xs);
  color: var(--app-text-secondary);
  line-height: 1.5;
}

.mm-export-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-1);
}

.mm-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-bg);
  overflow: hidden;
}

.mm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-bottom: 1px solid var(--app-border-soft);
  flex-wrap: wrap;
}

.mm-toolbar-left,
.mm-toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.mm-stat,
.mm-zoom {
  font-size: var(--text-xs);
  color: var(--app-text-secondary);
}

.mm-zoom {
  min-width: 42px;
  text-align: center;
}

.mm-stage-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-scroll {
  flex: 1;
  overflow: auto;
  cursor: grab;
  touch-action: none;
  background: var(--app-bg);
}

.mm-scroll.is-panning {
  cursor: grabbing;
}

.mm-svg {
  display: block;
}

.mm-node-clickable {
  cursor: pointer;
}

.mm-node-clickable:hover rect:first-of-type {
  filter: brightness(0.97);
}

@media (max-width: 900px) {
  .mm-shell {
    flex-direction: column;
    height: auto;
  }

  .mm-side {
    width: auto;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .mm-side-block {
    flex: 1 1 220px;
  }

  .mm-stage {
    height: 60vh;
  }
}
</style>
