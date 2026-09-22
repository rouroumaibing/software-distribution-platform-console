<script setup lang="ts">
// 全局搜索浮层（⌘K / Ctrl+K）—— CONSOLE-UI-DESIGN.md §5.3（R-7）+ §7.5。
// 职责只有渲染与键盘事件；状态在 `useGlobalSearch.ts`，纯逻辑在 `utils/search.ts`。
// 键盘契约（§5.3）：↑↓ 选择、Enter 打开、Esc 关闭；结果上限 20 条。
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  activeRoute,
  closePalette,
  moveActive,
  retryIndex,
  setActive,
  setQuery,
  useGlobalSearch,
} from '@/composables/useGlobalSearch'
import { SEARCH_KIND_LABEL, searchHitKey } from '@/utils/search'

const router = useRouter()
const { state, hits, status, activeHit, indexErrorMessage, fallbackNotice } = useGlobalSearch()

const inputEl = ref<HTMLInputElement>()
const listEl = ref<HTMLElement>()

/** 结果区已渲染几行 —— 四态下 foot 的计数文案要区分"没在搜"和"搜了没命中"。 */
const showList = computed(() => status.value === 'ready')
const hintText = computed(() =>
  state.query.trim() ? `无匹配「${state.query.trim()}」` : '资源索引为空 —— 先建组织 / 服务 / 组件',
)

watch(
  () => state.open,
  async (open) => {
    if (!open) return
    // 浮层打开就把焦点给输入框：⌘K 之后应该能直接打字，不该再点一下。
    await nextTick()
    inputEl.value?.focus()
  },
)

// 键盘移动选中项后，把高亮行滚进可视区（列表可滚动，20 条不一定都在视野里）。
watch(
  () => state.active,
  async () => {
    await nextTick()
    listEl.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  },
)

function open(hitIndex: number) {
  setActive(hitIndex)
  const route = activeRoute()
  if (!route) return
  closePalette()
  void router.push(route)
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      closePalette()
      break
    case 'ArrowDown':
      e.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      moveActive(-1)
      break
    case 'Enter':
      e.preventDefault()
      // 只开"键盘当前选中"的那条 —— 与 ↑↓ 高亮同源，不存在第二套目标。
      open(state.active)
      break
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.open" class="cp-scrim" @click.self="closePalette">
      <div class="cp-panel" role="dialog" aria-label="全局搜索" aria-modal="true">
        <div class="cp-input-row">
          <span class="cp-mag">🔍</span>
          <input
            ref="inputEl"
            class="cp-input"
            :value="state.query"
            placeholder="搜索组件 / 流水线 / Service…"
            autocomplete="off"
            spellcheck="false"
            @input="setQuery(($event.target as HTMLInputElement).value)"
            @keydown="onKeydown"
          />
          <span class="cp-kbd">Esc</span>
        </div>

        <div ref="listEl" class="cp-list">
          <!-- 降级必须可见：静默回落会让人以为"库里就是没有" -->
          <div v-if="fallbackNotice" class="cp-notice">{{ fallbackNotice }}</div>
          <!-- loading 文案区分两种等待：非空查询等的是服务端，空查询等的是本地索引 -->
          <div v-if="status === 'loading'" class="cp-state">
            {{ state.query.trim() ? '搜索中…' : '正在建立资源索引…' }}
          </div>

          <div v-else-if="status === 'error'" class="cp-state cp-state-err">
            <div>{{ indexErrorMessage }}</div>
            <button class="btn btn-pearl btn-sm" @click="retryIndex">重试</button>
          </div>

          <div v-else-if="status === 'empty'" class="cp-state">{{ hintText }}</div>

          <template v-else>
            <div
              v-for="(hit, i) in hits"
              :key="searchHitKey(hit)"
              class="cp-row"
              :class="{ on: i === state.active }"
              :data-active="i === state.active"
              @mouseenter="setActive(i)"
              @click="open(i)"
            >
              <span class="cp-kind">{{ SEARCH_KIND_LABEL[hit.kind] }}</span>
              <span class="cp-name">{{ hit.name }}</span>
              <span class="cp-path">{{ hit.path }}</span>
            </div>
          </template>
        </div>

        <div class="cp-foot">
          <span v-if="showList">{{ hits.length }} 条结果<template v-if="activeHit"> · 选中 <b>{{ activeHit.name }}</b></template></span>
          <span v-else>&nbsp;</span>
          <span class="spacer"></span>
          <span class="cp-hint"><span class="cp-kbd">↑</span><span class="cp-kbd">↓</span> 选择</span>
          <span class="cp-hint"><span class="cp-kbd">↵</span> 打开</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cp-scrim {
  position: fixed; inset: 0; background: var(--scrim); z-index: 400;
  display: flex; align-items: flex-start; justify-content: center; padding: 12vh 16px 0;
}
.cp-panel {
  width: min(640px, 92vw); background: var(--surface);
  border: 1px solid var(--hairline); border-radius: 14px;
  box-shadow: var(--shadow-pop); overflow: hidden;
  animation: cp-in 0.12s ease;
}
@keyframes cp-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

.cp-input-row {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid var(--hairline-2);
}
.cp-mag { font-size: 14px; color: var(--text-sub); }
.cp-input {
  flex: 1; min-width: 0; border: none; background: none; outline: none;
  font-family: var(--font); font-size: 15px; color: var(--text);
}
.cp-input::placeholder { color: var(--text-sub); opacity: 1; }
.cp-kbd {
  font-size: 11px; color: var(--text-sub); border: 1px solid var(--hairline);
  border-radius: 5px; padding: 1px 5px; font-family: var(--mono); white-space: nowrap;
}

.cp-list { max-height: 360px; overflow-y: auto; padding: 6px; }
.cp-state {
  padding: 26px 12px; text-align: center; color: var(--text-sub); font-size: 13px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.cp-state-err { color: var(--failed-fg); }

.cp-notice {
  margin: 4px 6px 2px; padding: 6px 10px; border-radius: 8px;
  font-size: 11.5px; color: var(--text-sub);
  background: var(--surface-2); border: 1px solid var(--hairline);
}
.cp-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 9px; cursor: pointer;
}
.cp-row.on { background: var(--surface-2); }
.cp-kind {
  font-size: 10.5px; color: var(--text-sub); border: 1px solid var(--hairline);
  border-radius: 5px; padding: 1px 6px; white-space: nowrap; flex: 0 0 auto;
}
.cp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-row.on .cp-name { font-weight: 600; }
.cp-path { font-size: 11.5px; color: var(--text-sub); white-space: nowrap; }

.cp-foot {
  display: flex; align-items: center; gap: 14px;
  padding: 8px 14px; border-top: 1px solid var(--hairline-2);
  font-size: 12px; color: var(--text-sub);
}
.cp-foot .spacer { flex: 1; }
.cp-foot b { color: var(--text); }
.cp-hint { display: inline-flex; align-items: center; gap: 4px; }
</style>
