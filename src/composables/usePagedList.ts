import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/** 有界列表窗口：一次只把固定数量的卡片交给 Vue 渲染，避免长列表撑爆 WebView。 */
export function usePagedList<T>(source: MaybeRefOrGetter<readonly T[]>, pageSize = 24) {
  const page = ref(1)
  const items = computed(() => toValue(source))
  const pageCount = computed(() => Math.max(1, Math.ceil(items.value.length / pageSize)))
  const pageItems = computed(() => {
    const start = (page.value - 1) * pageSize
    return items.value.slice(start, start + pageSize)
  })

  watch(pageCount, (count) => {
    if (page.value > count) page.value = count
  })

  function goTo(target: number) {
    page.value = Math.min(Math.max(1, target), pageCount.value)
  }

  return {
    page,
    pageCount,
    pageItems,
    goTo,
    previous: () => goTo(page.value - 1),
    next: () => goTo(page.value + 1),
  }
}
