// 全局搜索（⌘K）的**组合层**：命中池来源、浮层的打开/查询/选中状态。
// 纯逻辑（打分/排序/快捷键/索引移动）在 `src/utils/search.ts`；渲染在 `CommandPalette.vue`。
// 设计依据：CONSOLE-UI-DESIGN.md §5.3（R-7）+ §5.1.1（⌘K 是替代"树里翻"的补偿路径）。
//
// **命中池有两个来源（R-8 起）**：
//   1) 服务端 `GET /search`（附 A N-8，非空查询的首选）—— 语料不受"每层 100 条"的
//      客户端拉取上限影响，是规模化后的正确来源；
//   2) 客户端资源索引（`useResourceMap.buildResourceIndex`）—— 两个用途：
//      空查询时提供"可键盘浏览的头部视图"（§5.3 明确要求），以及服务端不可用时的降级。
// 服务端优先但不"失败即白屏"：失败时回落到索引并**在浮层里明说**降级了，
// 静默降级会让人以为"库里就是没有"。
import { computed, reactive, watch } from 'vue'
import { searchApi } from '@/api/search'
import { buildResourceIndex } from '@/composables/useResourceMap'
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  isPaletteShortcut,
  matchHits,
  moveIndex,
  searchHitKey,
  searchHitRoute,
  type SearchHit,
  type SearchRoute,
} from '@/utils/search'

type PaletteStatus = 'loading' | 'error' | 'empty' | 'ready'

const state = reactive({
  open: false,
  /** 输入框的即时值（受控）。 */
  query: '',
  /** 防抖后的值 —— 结果只跟着它走（§5.3 防抖 200ms）。 */
  debounced: '',
  /** 客户端索引命中池（空查询 / 降级用）。 */
  index: [] as SearchHit[],
  indexReady: false,
  indexError: '',
  /** 服务端命中池。 */
  serverHits: [] as SearchHit[],
  /** serverHits 对应的查询词 —— 只有与当前 debounced 相等才可用（否则是过期结果）。 */
  serverQuery: '',
  serverError: '',
  /** 键盘选中项下标；-1 = 无选中。 */
  active: -1,
})

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let indexPromise: Promise<void> | undefined
/** 服务端搜索的请求序号，用于丢弃过期响应（打字快于网络时会乱序到达）。 */
let serverSeq = 0

/** 当前是否用服务端结果：非空查询 + 结果属于这个词 + 没出错。 */
const serverActive = computed(() => {
  const q = state.debounced.trim()
  return q.length > 0 && state.serverQuery === state.debounced && !state.serverError
})

/** 结果只取前 SEARCH_LIMIT 条（§5.3）；空查询给一份可浏览的尾部视图。 */
const hits = computed(() =>
  serverActive.value ? matchHits(state.serverHits, state.debounced) : matchHits(state.index, state.debounced),
)

const status = computed<PaletteStatus>(() => {
  const q = state.debounced.trim()
  if (q && !state.serverError) {
    // 服务端优先：在它回来之前显示"搜索中"，不要先闪一份客户端索引的结果
    // 再被替换 —— 那会让列表跳一下，还可能让人按回车打开错的那条。
    if (state.serverQuery !== state.debounced) return 'loading'
    return hits.value.length === 0 ? 'empty' : 'ready'
  }
  if (state.indexError) return 'error'
  if (!state.indexReady) return 'loading'
  return hits.value.length === 0 ? 'empty' : 'ready'
})

/** 当前选中项（模板高亮用）。越界时回落 undefined，不会抛。 */
const activeHit = computed<SearchHit | undefined>(() => hits.value[state.active])

/** 索引构建失败时给出的可读原因（浮层里直接展示，不吞错）。 */
const indexErrorMessage = computed(() => state.indexError || '资源索引加载失败')

/** 服务端搜索降级提示：有内容就在浮层里显示一行，不静默。 */
const fallbackNotice = computed(() =>
  state.serverError ? '服务端搜索不可用，已在已加载资源内搜索' : '',
)

function scheduleDebounce() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    state.debounced = state.query
  }, SEARCH_DEBOUNCE_MS)
}

/** 索引只建一次，失败后可重试（不缓存失败结果）。 */
function ensureIndex(): Promise<void> {
  indexPromise ??= buildResourceIndex()
    .then((idx) => {
      const hits: SearchHit[] = [
        ...idx.services.map((s) => ({
          kind: 'service' as const,
          id: s.serviceId,
          name: s.serviceName,
          path: s.orgName,
          keyword: s.serviceKey,
        })),
        ...idx.components.map((c) => ({
          kind: 'component' as const,
          id: c.componentId,
          name: c.componentName,
          path: `${c.orgName} / ${c.serviceName}`,
          keyword: c.componentKey,
        })),
        ...idx.pipelines.map((p) => ({
          kind: 'pipeline' as const,
          id: p.pipelineId,
          name: p.pipelineName,
          path: `${p.componentName} · ${p.kind}`,
        })),
      ]
      state.index = hits
      state.indexReady = true
      state.indexError = ''
    })
    .catch((e: unknown) => {
      state.indexError = e instanceof Error ? e.message : String(e)
      indexPromise = undefined // 允许重试
    })
  return indexPromise
}

async function runServerSearch(q: string) {
  const seq = ++serverSeq
  try {
    const found = await searchApi.query({ q, limit: SEARCH_LIMIT })
    if (seq !== serverSeq) return
    state.serverHits = found
    state.serverQuery = q
    state.serverError = ''
  } catch (e: unknown) {
    if (seq !== serverSeq) return
    state.serverError = e instanceof Error ? e.message : String(e)
    state.serverHits = []
    state.serverQuery = ''
    // 降级必须有东西可搜：确保客户端索引在跑（失败时上面会记 indexError）。
    void ensureIndex()
  }
}

watch(
  () => state.debounced,
  (q) => {
    if (!q.trim()) {
      // 清空输入回到"可浏览的头部视图"，同时作废在途的服务端请求。
      serverSeq++
      state.serverHits = []
      state.serverQuery = ''
      state.serverError = ''
      return
    }
    void runServerSearch(q)
  },
)

/** 打开浮层：立即给一份结果（不做首次防抖，否则空面板先闪 200ms）。 */
export function openPalette() {
  state.open = true
  state.query = ''
  state.debounced = ''
  state.active = -1
  // 索引照旧在后台建：空查询的"头部视图"要靠它，服务端搜索失败时也要靠它。
  // 但它不再是唯一来源，所以与打字并发也不影响正确性。
  void ensureIndex()
}

export function closePalette() {
  state.open = false
  if (debounceTimer) clearTimeout(debounceTimer)
}

export function togglePalette() {
  if (state.open) closePalette()
  else openPalette()
}

export function setQuery(v: string) {
  state.query = v
  scheduleDebounce()
}

/** ↑↓ 移动选中（不环绕；见 utils/search.moveIndex）。 */
export function moveActive(delta: number) {
  state.active = moveIndex(state.active, delta, hits.value.length)
}

/** Enter：返回选中项的跳转目标；无选中返回 null（调用方不导航）。 */
export function activeRoute(): SearchRoute | null {
  const hit = activeHit.value
  return hit ? searchHitRoute(hit) : null
}

/** 鼠标 hover 也要能改选中项，否则"看着第一行、回车打开第二行"。 */
export function setActive(index: number) {
  state.active = index
}

export function retryIndex() {
  state.indexError = ''
  state.serverError = ''
  state.serverQuery = ''
  void ensureIndex()
  if (state.debounced.trim()) void runServerSearch(state.debounced)
}

// 结果集变了就把选中项拉回第一条：回车必须总能打开"眼睛看到的第一条"。
watch(hits, (list) => {
  state.active = list.length > 0 ? 0 : -1
})

/**
 * 装全局快捷键（只装一次；在 App.vue 的 onMounted 里调用）。
 * 返回卸载函数，便于 HMR / 组件销毁时清干净。
 */
export function installPaletteShortcut() {
  const onKeydown = (e: KeyboardEvent) => {
    if (!isPaletteShortcut(e)) return
    e.preventDefault()
    togglePalette()
  }
  document.addEventListener('keydown', onKeydown)
  return () => document.removeEventListener('keydown', onKeydown)
}

export function useGlobalSearch() {
  return {
    state,
    hits,
    status,
    activeHit,
    activeRoute,
    indexErrorMessage,
    fallbackNotice,
    hitKey: searchHitKey,
  }
}
