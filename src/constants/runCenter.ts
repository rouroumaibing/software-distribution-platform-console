// 运行中心两视图（IA v4.4；URL 形态裁决见 CONSOLE-UI-DESIGN.md 附 B，N-13）。
//
// 「运行 / 发布」是同一批数据的两个切面，不是子页面 —— 所以走
//   /runs?view=runs|releases
// 的 query，而不是嵌套子路由 /runs/releases。
//
// 「流水线」视图已于 v4.4 移除（2026-09-19 同步到代码）：流水线是**组件级资源**，
// 其列表天然归属「组件详情 · 交付 · 流水线」；跨组件再单列一份 = 同信息多入口。
//
// 本文件是视图 key、中文名、视图内筛选项的唯一事实源：切换条、面包屑、深链
// 归一化全部从这里取（附 B 硬约束 ②：面包屑同源，禁止另建 view → 名称映射表）。

export type RunViewKey = 'runs' | 'releases'

export interface RunViewFilter {
  /** '' = 全部。取值是 PipelineRunPhase 的真实枚举值，下推 hub GET /runs?phase=。 */
  value: string
  label: string
}

export interface RunViewDef {
  key: RunViewKey
  /** 切换条与面包屑第二段共用的中文名。 */
  label: string
  filters: RunViewFilter[]
}

export const RUN_VIEWS: RunViewDef[] = [
  {
    key: 'runs',
    label: '运行',
    // phase 直传 hub GET /runs?phase=，服务端过滤。
    // 筛选项按原型 RUN_FILTERS.runs（文档 §7.6）：全部 / 运行中 / 失败 / 待我审批。
    // 「待我审批」的"待我"这层身份过滤需 hub 的 assignee=me（附 A N-2），未落地前
    // 退化为 phase=WaitingApproval（会列出所有人的待审批）—— 标签表达的意图先于能力。
    filters: [
      { value: '', label: '全部' },
      { value: 'Running', label: '运行中' },
      { value: 'Failed', label: '失败' },
      { value: 'WaitingApproval', label: '待我审批' },
    ],
  },
  {
    key: 'releases',
    label: '发布',
    // 发布 = kind=release 的流水线的运行，所以筛的仍是运行 phase（发布没有自己的
    // phase 枚举）。
    //
    // 原型 RUN_FILTERS.releases = 全部 / 进行中 / 已暂停 / 成功。其中「已暂停」在真实
    // 实现版**暂不渲染**：Paused 是 Rollout（runner Rollout CRD）的**任务级**状态，
    // 不在 PipelineRunPhase 六枚举（Pending/Running/WaitingApproval/Succeeded/Failed/
    // Cancelled）里，要按它筛列表必须逐 run 拉 GET /runs/:id/tasks（N+1）。等 hub 提供
    // GET /releases?scope=global&state=paused（附 A N-3 / 附 B B.9）后再补该筛选项；
    // 在此之前不渲染该死控件（原型铁律：不渲染无 handler 的装饰控件）。
    filters: [
      { value: '', label: '全部' },
      { value: 'Running', label: '进行中' },
      { value: 'Succeeded', label: '成功' },
    ],
  },
]

export const DEFAULT_RUN_VIEW: RunViewKey = 'runs'

const VIEW_KEYS = RUN_VIEWS.map((v) => v.key)

export function isRunViewKey(v: unknown): v is RunViewKey {
  return typeof v === 'string' && (VIEW_KEYS as string[]).includes(v)
}

/** 未知/缺省 key 一律回落到默认视图，调用方不需要再判空。 */
export function getRunView(key: unknown): RunViewDef {
  return RUN_VIEWS.find((v) => v.key === key) ?? RUN_VIEWS[0]
}

/** 面包屑第二段中文名：与 RUN_VIEWS 同源（附 B 硬约束 ②）。 */
export function runViewLabel(key: unknown): string {
  return getRunView(key).label
}

/** 深链来的 phase 是否属于当前视图 —— 不属于就丢弃（避免 ?view=releases&phase=build 这种混搭残留）。 */
export function isValidRunFilter(key: unknown, value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return true
  return getRunView(key).filters.some((f) => f.value === value)
}

// ---------------------------------------------------------------------------
// URL 契约：两视图的 query 只有一种合法形态（附 B 硬约束 ①③）。
// 放在常量层而不是组件里，是为了让「归一化 / 参数序列化」这两条规则可以被
// 直接单测 —— 它们是 URL 契约，不是页面私有逻辑。
// ---------------------------------------------------------------------------

export interface RunCenterQuery {
  view: RunViewKey
  /** '' = 全部 */
  phase: string
  page: number
}

const DEFAULT_PAGE = 1

/** 任意 query（含缺省/非法）→ 规范形态。缺省 view 落到 runs，非法 phase/page 丢掉。 */
export function canonicalRunQuery(query: Record<string, unknown>): RunCenterQuery {
  const view: RunViewKey = isRunViewKey(query.view) ? query.view : DEFAULT_RUN_VIEW
  const rawPhase = typeof query.phase === 'string' ? query.phase : ''
  const phase = isValidRunFilter(view, rawPhase) ? rawPhase : ''
  const rawPage = typeof query.page === 'string' ? Number(query.page) : NaN
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : DEFAULT_PAGE
  return { view, phase, page }
}

/** 规范形态 → query 参数：默认值（view 之外的 '' / 第 1 页）不写进地址栏。 */
export function runQueryParams(q: RunCenterQuery): Record<string, string> {
  const out: Record<string, string> = { view: q.view }
  if (q.phase) out.phase = q.phase
  if (q.page > DEFAULT_PAGE) out.page = String(q.page)
  return out
}

/** 两个 query 是否完全一致（忽略 key 顺序）—— 用来判断要不要 replace。 */
export function sameQuery(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}
