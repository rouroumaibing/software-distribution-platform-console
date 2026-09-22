// 服务树独立页（R-8）的**纯逻辑**：可见行扁平化、虚拟滚动窗口、懒加载状态机、滚动定位。
//
// 本文件**刻意零 import**（连 `./search` 都不 import，理由见下）：`scripts/service-tree-smoke.mjs`
// 用 node 原生类型剥离直接 import 它 —— 测的是出厂代码本身，不是复制品。Node 的 ESM
// 解析要求相对导入带扩展名，而带 `.ts` 扩展名会让 `vue-tsc --noEmit` 报错
//（除非开 allowImportingTsExtensions）。所以这里只放"没有任何跨文件依赖"的逻辑，
// 类型标签、分组渲染留在组件层。
//
// 设计依据：CONSOLE-UI-DESIGN.md §4.1（懒加载 / 服务端搜索 / 虚拟滚动 / 独立滚动容器）。

/**
 * 行高（px）。虚拟滚动的窗口计算与**每行实际高度必须来自同一个常量**：
 * 一处写在 CSS、一处写在 JS，改样式时就会静默错位（行互相压、点错行）。
 * 因此 ServiceTreeView 的行高走内联 style 引用本常量，CSS 里不再声明高度。
 */
export const TREE_ROW_HEIGHT = 30

/** 达到该节点数才启用窗口化渲染（§4.1「≥200 节点只渲染可见行」）。 */
export const VIRTUALIZE_THRESHOLD = 200

/** 视口上下各多渲染几行，避免快速滚动时露白。 */
export const OVERSCAN = 6

/** 懒加载状态机的四态。`collapsed` 是初态：**未展开 = 未请求**。 */
export type LazyState = 'collapsed' | 'loading' | 'expanded' | 'error'

/** 触发一次点击后该做什么。把状态机抽成纯函数，避免把分支散在模板里。 */
export type ExpandAction = 'load' | 'collapse' | 'retry' | 'ignore'

/**
 * 扁平化所需的**结构约束**（而不是具体类型）：页面侧真正的节点类型带
 * Service/Component 载荷，会依赖 `@/api/*`；这里只要求它长成树的样子。
 */
export interface TreeRowLike {
  id: string
  name: string
  state: LazyState
  children: readonly TreeRowLike[]
}

export interface FlatRow<T> {
  node: T
  /** 0 = 服务树根，1 = Service，2 = 组件。仅用于缩进，不参与业务判断。 */
  depth: number
  /** 在扁平列表里的下标 —— 虚拟滚动的定位基准、键盘上下移动的坐标系。 */
  index: number
}

/**
 * 把"当前可见的树"压成一维行列表。
 * 只对 `state === 'expanded'` 的节点下钻 —— 这正是懒加载的兑现方式：
 * 没展开就没有子节点可渲染，也不会有对应的请求。
 */
export function flattenVisible<T extends TreeRowLike>(
  roots: readonly T[],
  depth = 0,
  out: FlatRow<T>[] = [],
): FlatRow<T>[] {
  for (const node of roots) {
    // 先取 index 再 push：index 就是它即将占据的下标。
    out.push({ node, depth, index: out.length })
    if (node.state === 'expanded' && node.children.length > 0) {
      flattenVisible(node.children as readonly T[], depth + 1, out)
    }
  }
  return out
}

export interface WindowResult {
  /** 需要渲染的区间 `[start, end)`。 */
  start: number
  end: number
  /** 起始行的纵向偏移（px），供 `top: index*rowHeight` 的绝对定位方案使用。 */
  offsetY: number
  /** 撑开滚动条用的总高度（px）＝ 总行数 × 行高。 */
  totalHeight: number
}

/**
 * 计算虚拟滚动窗口。
 * 参数全部可选以便单测；`viewportHeight` 为 0 时只渲染 overscan 数量的行，
 * 不会退化成"渲染全部"（这正是窗口化的意义）。
 */
export function computeWindow(
  scrollTop: number,
  total: number,
  opts: { rowHeight?: number; viewportHeight?: number; overscan?: number } = {},
): WindowResult {
  const rowHeight = opts.rowHeight ?? TREE_ROW_HEIGHT
  const viewportHeight = Math.max(0, opts.viewportHeight ?? 0)
  const overscan = opts.overscan ?? OVERSCAN
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }
  }
  const top = Math.max(0, scrollTop)
  const firstVisible = Math.floor(top / rowHeight)
  const visibleRows = Math.ceil(viewportHeight / rowHeight)
  let start = Math.max(0, firstVisible - overscan)
  let end = Math.min(total, firstVisible + visibleRows + overscan)
  if (start >= end) {
    // 滚过头（scrollTop 超出内容高度，缩放/内容变化时浏览器会给到这种值）：
    // 把窗口吸附到最后一屏。不做这一步的话区间会**反转**（start > end），
    // 上层 slice 得到空数组 —— 表现为整棵树突然白掉。
    end = total
    start = Math.max(0, total - visibleRows - overscan)
  }
  return { start, end, offsetY: start * rowHeight, totalHeight: total * rowHeight }
}

/** 是否启用窗口化渲染（§4.1：≥200 节点）。 */
export function shouldVirtualize(total: number, threshold = VIRTUALIZE_THRESHOLD): boolean {
  return total >= threshold
}

/**
 * 点击一个节点后的动作。
 *   collapsed → load（首次展开，此时才发请求）
 *   loading   → ignore（**防重复请求**：连点/快速键盘操作不该打出一串并发）
 *   expanded  → collapse（折叠不回收已加载的子节点，再次展开不必重取）
 *   error     → retry
 */
export function expandAction(state: LazyState): ExpandAction {
  switch (state) {
    case 'collapsed':
      return 'load'
    case 'loading':
      return 'ignore'
    case 'expanded':
      return 'collapse'
    case 'error':
      return 'retry'
  }
}

/**
 * 未展开节点右侧的提示文案。
 *
 * ⚠️ 与原型的一处**显式差异**：§4.1 原型写的是「N 项 · 点开时加载」，但 N 只有
 * 请求过才知道 —— 而懒加载的全部意义就是"不展开就不请求"。要么提前请求（等于
 * 放弃懒加载），要么这个 N 是编的。这里选择诚实：**计数未知时说"点开时加载"**，
 * 已知时（折叠回来过，计数被记住）才显示「N 项 · 点开时加载」。
 */
export function lazyHintLabel(state: LazyState, knownCount?: number): string {
  switch (state) {
    case 'loading':
      return '加载中…'
    case 'error':
      return '加载失败 · 点击重试'
    case 'collapsed':
      return knownCount === undefined ? '点开时加载' : `${knownCount} 项 · 点开时加载`
    case 'expanded':
      return ''
  }
}

/**
 * 让第 index 行进入视口所需的 scrollTop（已经可见就原样返回，避免跳动）。
 * 选中项（含 `?node=` 深链定位到的、以及键盘移动到的行）必须可见，
 * 否则"定位成功"在用户眼里等于没发生。
 */
export function ensureVisible(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  opts: { rowHeight?: number } = {},
): number {
  const rowHeight = opts.rowHeight ?? TREE_ROW_HEIGHT
  if (index < 0) return scrollTop
  const top = index * rowHeight
  const bottom = top + rowHeight
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight)
  return scrollTop
}
