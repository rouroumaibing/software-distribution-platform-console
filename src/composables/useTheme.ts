// 主题 / 灰阶的**运行时状态 + 副作用**。纯逻辑在 `src/utils/theme.ts`（那边不碰 DOM，
// 可被 node 冒烟测试直接 import），本文件只负责「读一次 → 落属性 → 存回去」。
// 设计依据：CONSOLE-UI-DESIGN.md §9.6 主题机制。
//
// 状态用模块级单例（不是 Pinia store）：主题属于 DOM 根节点的全局副作用，
// 只有一个实例，且要在任何组件挂载**之前**就绪 —— 用 store 反而要在 main.ts 里
// 先拿 pinia 实例，得不偿失。
import { reactive } from 'vue'
import {
  GRAY_CLASS,
  GRAY_STORAGE_KEY,
  THEME_ATTR,
  THEME_STORAGE_KEY,
  nextTheme,
  parseGray,
  resolveInitialTheme,
  serializeGray,
  type ThemeMode,
} from '@/utils/theme'

const state = reactive({
  theme: 'light' as ThemeMode,
  gray: false,
})

/** 系统是否偏好暗色。matchMedia 缺失（老浏览器 / SSR 兜底）时按明色处理。 */
function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 把当前状态落到 `<html>` 上。这是**唯一**写 DOM 属性的地方。
 * 注意：index.html 的内联脚本已经抢先设过一次（防白闪），这里不是"首次设置"，
 * 而是把已生效的值同步进 JS 状态，避免两边漂移。
 */
function apply() {
  const el = document.documentElement
  el.setAttribute(THEME_ATTR, state.theme)
  el.classList.toggle(GRAY_CLASS, state.gray)
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // 隐私模式下 getItem 可能抛错；读不到就当没存过
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存不进去只影响"下次记住"，不影响本次会话，静默降级
  }
}

/**
 * 启动时调用一次（main.ts，mount 之前）。幂等：重复调用不会重置用户已做的选择。
 * 不监听 `prefers-color-scheme` 的后续变化 —— 用户一旦手动切过就以存储为准，
 * 没切过也只在启动时取一次（§9.6 只定义了"默认值"，未定义"跟随系统实时变化"）。
 */
export function initTheme() {
  state.theme = resolveInitialTheme(readStorage(THEME_STORAGE_KEY), prefersDark())
  state.gray = parseGray(readStorage(GRAY_STORAGE_KEY))
  apply()
}

export function toggleTheme() {
  state.theme = nextTheme(state.theme)
  writeStorage(THEME_STORAGE_KEY, state.theme)
  apply()
}

export function toggleGray() {
  state.gray = !state.gray
  writeStorage(GRAY_STORAGE_KEY, serializeGray(state.gray))
  apply()
}

/** 组件侧只读状态 + 两个动作；状态本身是响应式的，模板直接用即可。 */
export function useTheme() {
  return { theme: state, toggleTheme, toggleGray }
}
