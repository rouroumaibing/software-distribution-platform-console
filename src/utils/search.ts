// 全局搜索（⌘K）的**纯逻辑**：命中打分、排序、截断、键盘索引移动、快捷键判定。
// 本文件**刻意零 import**，原因有二：
//   1) `scripts/search-smoke.mjs` 用 node 原生类型剥离直接 import 它（与 `constants/runCenter.ts`
//      同一手法：测出厂代码本身，不是复制品）—— 一旦引入 `@/` 别名就跨不过去；
//   2) 索引构建（要打 API）与浮层渲染（要 DOM）都是副作用，属于组合层/组件层的事。
// 设计依据：CONSOLE-UI-DESIGN.md §5.3 全局搜索（R-7）/ §7.5 全局搜索浮层。

export type SearchKind = 'component' | 'pipeline' | 'service'

/** 结果行 = 类型标签 + 名称 + 所属路径（§5.3）。`keyword` 只参与匹配、不展示。 */
export interface SearchHit {
  kind: SearchKind
  id: string
  name: string
  path: string
  keyword?: string
}

/** 打开结果时的跳转目标（与 vue-router 的 to 同形）。 */
export interface SearchRoute {
  path: string
  query?: Record<string, string>
}

/** 结果上限 20 条（§5.3 硬约束）。 */
export const SEARCH_LIMIT = 20

/** 输入防抖 200ms（§5.3 硬约束）。客户端过滤下它是"体验预算"，
 *  索引变大（或日后换成服务端 /search）后就是真实成本闸门。 */
export const SEARCH_DEBOUNCE_MS = 200

/** 类型标签是中文短词，同时也是可匹配文本（原型即按 `名称+路径+类型` 过滤）。 */
export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  component: '组件',
  pipeline: '流水线',
  service: 'Service',
}

/** 稳定身份：同名不同 id 的两条结果必须能区分（列表 key 与去重都靠它）。 */
export function searchHitKey(hit: SearchHit): string {
  return `${hit.kind}:${hit.id}`
}

/** 后端 `GET /search` 的一条命中（字段名以 hub 的 search/models.Hit 为准）。 */
export interface SearchHitDto {
  type: string
  id: string
  name: string
  path: string
  keyword?: string
}

const SEARCH_KINDS: readonly SearchKind[] = ['component', 'pipeline', 'service']

export function isSearchKind(v: string): v is SearchKind {
  return (SEARCH_KINDS as readonly string[]).includes(v)
}

/**
 * DTO → SearchHit（type → kind 的翻译放在这里）。
 *
 * 认不出的 type 返回 undefined 而**不是原样透传**：后端日后加了新资源类型（如 target）
 * 时，`searchHitRoute` 没有对应分支，强行走过去只会导航到 404 —— 不如先不展示。
 * 放在 utils 而非 api 层，是为了让它能被 node 直接 import 做冒烟断言
 * （api 层会牵出 axios 与 pinia store）。
 */
export function hitFromDto(dto: SearchHitDto): SearchHit | undefined {
  if (!dto || !isSearchKind(dto.type) || !dto.id) return undefined
  return { kind: dto.type, id: dto.id, name: dto.name, path: dto.path, keyword: dto.keyword }
}

/**
 * 打开行为（§5.3）：组件 → `/components/:id`；流水线 → `/pipelines/:id`（编辑器）；
 * Service → **服务树页定位**（`/service-tree?node=:id&org=:orgName`，由 ServiceTreeView
 * 选中该节点）。
 * Service 之所以不是自己的详情页：服务树是它唯一的归属页，脱离层级上下文单开一页
 * 反而要重复实现一套面包屑。
 */
export function searchHitRoute(hit: SearchHit): SearchRoute {
  switch (hit.kind) {
    case 'component':
      return { path: `/components/${hit.id}` }
    case 'pipeline':
      return { path: `/pipelines/${hit.id}` }
    case 'service': {
      // `org` 是**定位提示**，不是权威数据：服务树在 R-8 之后是懒加载的，只给 id
      // 的话页面得逐个组织把服务列表拉一遍才找得到该服务（N 次请求）。服务命中的
      // `path` 恰好就是所属组织名（服务端返回 / 客户端索引都如此），直接当提示用，
      // 命中时 1 次请求都不用扫。path 为空时退化为只带 node（页面侧有兜底扫描）。
      const query: Record<string, string> = { node: hit.id }
      if (hit.path) query.org = hit.path
      return { path: '/service-tree', query }
    }
  }
}

/**
 * 命中打分：越小越靠前；-1 = 不命中。
 * 原型用的是 `(名称+路径+类型).includes(q)` 一把梭 —— 这里把它**细化成分档**：
 * 全等 > 名称前缀 > 名称子串 > 路径子串 > 类型名子串 > 别名子串。
 * 单一 `includes` 会让"搜 comp-web 时 comp-web-old 排到 comp-web 前面"，
 * 键盘选中后回车打开的很可能是错的那个；分档把精确命中钉在第一行。
 */
export function scoreHit(hit: SearchHit, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return 0
  const name = hit.name.toLowerCase()
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(q)) return 2
  if (hit.path.toLowerCase().includes(q)) return 3
  if (SEARCH_KIND_LABEL[hit.kind].toLowerCase().includes(q)) return 4
  if (hit.keyword && hit.keyword.toLowerCase().includes(q)) return 5
  return -1
}

/**
 * 过滤 + 排序 + 截断。**空查询返回索引前 `limit` 条**（与原型一致：浮层打开即可见
 * 一份可键盘浏览的全量视图，而不是一堵"请输入关键词"的空墙）。
 * 排序对同分项保持索引原序（显式带 `index` 兜底 `sort`，不依赖引擎稳定性）。
 */
export function matchHits(hits: readonly SearchHit[], rawQuery: string, limit = SEARCH_LIMIT): SearchHit[] {
  const q = rawQuery.trim()
  if (!q) return hits.slice(0, limit)
  const scored: { hit: SearchHit; score: number; index: number }[] = []
  hits.forEach((hit, index) => {
    const score = scoreHit(hit, q)
    if (score >= 0) scored.push({ hit, score, index })
  })
  scored.sort((a, b) => (a.score - b.score) || (a.index - b.index))
  return scored.slice(0, limit).map((s) => s.hit)
}

/** ↑↓ 移动选中项：**不环绕**（到顶/到底即停），与主流命令面板一致。 */
export function moveIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return -1
  const base = current < 0 ? (delta > 0 ? -1 : total) : current
  const next = base + delta
  if (next < 0) return 0
  if (next > total - 1) return total - 1
  return next
}

/** ⌘K（macOS）/ Ctrl+K（其他平台）唤起浮层（§5.3）。 */
export function isPaletteShortcut(e: { metaKey?: boolean; ctrlKey?: boolean; key?: string }): boolean {
  const key = (e.key ?? '').toLowerCase()
  return (!!e.metaKey || !!e.ctrlKey) && key === 'k'
}
