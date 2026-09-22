// 双主题 + 灰阶的**纯逻辑**（不触碰 DOM），供三处共用：
//   1) `index.html` 的首屏内联脚本 —— 只能内联，无法 import，故此处逻辑必须
//      **可逐行照抄**（键名/取值见下方常量，改一个必须同步改另一个，两处都有交叉注释）；
//   2) `src/composables/useTheme.ts` —— 运行时状态与副作用；
//   3) `scripts/theme-and-search-smoke.mjs` —— node 直接 import 本文件做断言。
// 设计依据：CONSOLE-UI-DESIGN.md §9.6 主题机制 / §9.2 令牌 / §9.1 克制动效。

export type ThemeMode = 'light' | 'dark'

/** localStorage 键（index.html 内联脚本里是字面量，两边必须一致）。 */
export const THEME_STORAGE_KEY = 'sdp.console.theme'
export const GRAY_STORAGE_KEY = 'sdp.console.gray'

/** 主题落在 `<html>` 上的属性名（§9.6：`data-theme`，不是 class）。 */
export const THEME_ATTR = 'data-theme'

/** 灰阶开时挂在 `<html>` 上的 class（§9.6：`filter: grayscale(1)`）。 */
export const GRAY_CLASS = 'gray'

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark']

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark'
}

/** 任意输入 → 合法主题；非法/缺省一律 null（把「回退」决策交给调用方）。 */
export function normalizeTheme(v: unknown): ThemeMode | null {
  return isThemeMode(v) ? v : null
}

/**
 * 首次进入时的主题（§9.6）：「读 localStorage → 无则 prefers-color-scheme」。
 * 存储里是非法值（旧版本残留、被人手改过）一律当作「无」，不做二次猜测。
 */
export function resolveInitialTheme(stored: unknown, prefersDark: boolean): ThemeMode {
  return normalizeTheme(stored) ?? (prefersDark ? 'dark' : 'light')
}

/** 主题切换只在这两态之间来回，没有第三态（也就不需要 reset 语义）。 */
export function nextTheme(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark'
}

/**
 * 顶栏按钮的可见文案 = **下一步动作**（与原型 `themeBtn` 一致：暗色时显示「明」）。
 * 文案随动作而非状态，是为了让图标/文字的语义在两种主题下都成立。
 */
export function themeToggleLabel(current: ThemeMode): string {
  return current === 'dark' ? '明' : '暗'
}

export function themeToggleTitle(current: ThemeMode): string {
  return current === 'dark' ? '切换到明色主题' : '切换到暗色主题'
}

/** 灰阶是纯开关，只在 '1' 时为开（'0' / null / 垃圾值都当关，避免"存了个真值"就开）。 */
export function parseGray(stored: unknown): boolean {
  return stored === '1'
}

export function serializeGray(on: boolean): string {
  return on ? '1' : '0'
}
