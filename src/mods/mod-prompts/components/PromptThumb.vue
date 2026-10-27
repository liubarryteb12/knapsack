<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PromptItem } from '../schema'
import { usePromptsStore } from '../store'

const props = defineProps<{
  item: PromptItem
}>()

const store = usePromptsStore()
const src = ref('')
const host = ref<HTMLElement | null>(null)
const visible = ref(false)
let objectUrl = ''
let observer: IntersectionObserver | null = null

function revoke() {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  src.value = ''
}

watch(
  () => [props.item.id, props.item.coverMediaId, visible.value] as const,
  async ([itemId, coverMediaId, isVisible]) => {
    revoke()
    if (!coverMediaId || !isVisible) return
    const media = (await store.loadMedia(itemId)).find((row) => row.mediaId === coverMediaId)
    if (!media) return
    objectUrl = URL.createObjectURL(media.blob)
    src.value = objectUrl
  },
  { immediate: true },
)

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !host.value) {
    visible.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      visible.value = true
      observer?.disconnect()
      observer = null
    },
    { rootMargin: '160px' },
  )
  observer.observe(host.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  revoke()
})
</script>

<template>
  <div ref="host" class="prompt-thumb-frame">
    <img v-if="src" class="prompt-thumb" :src="src" alt="" />
  </div>
</template>

<style scoped>
.prompt-thumb-frame {
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--app-chip-bg);
}

.prompt-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
