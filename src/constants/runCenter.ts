// 运行中心三视图（IA v4；URL 形态裁决见 CONSOLE-UI重设计文档.md 附 B，N-13）。
//
// 「运行 / 流水线 / 发布」是同一批数据的三个切面，不是子页面 —— 所以走
//   /runs?view=runs|pipelines|releases
// 的 query，而不是嵌套子路由 /runs/pipelines。
//
// 本文件是视图 key、中文名、视图内筛选项的唯一事实源：切换条、面包屑、深链
// 归一化全部从这里取（附 B 硬约束 ②：面包屑同源，禁止另建 view → 名称映射表）。

export type RunViewKey = 'runs' | 'pipelines' | 'releases'

export interface RunViewFilter {
  /** '' = 全部。运行/发布视图是 PipelineRunPhase（下推 hub GET /runs?phase=），
   *  流水线视图是 Pipeline.kind（前端聚合后过滤）。 */
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
    filters: [
      { value: '', label: '全部' },
      { value: 'Running', label: '运行中' },
      { value: 'Failed', label: '失败' },
      { value: 'WaitingApproval', label: '待审批' },
      { value: 'Succeeded', label: '成功' },
    ],
  },
  {
    key: 'pipelines',
    label: '流水线',
    // 流水线没有 phase，按 kind 过滤（前端聚合数据上过滤）。
    filters: [
      { value: '', label: '全部' },
      { value: 'build', label: '构建' },
      { value: 'release', label: '发布' },
      { value: 'custom', label: '自定义' },
    ],
  },
  {
    key: 'releases',
    label: '发布',
    // 发布 = kind=release 的流水线的运行，所以筛的仍是运行 phase。
    //
    // 刻意没有「已暂停」：Paused 是 Rollout（runner Rollout CRD）的**任务级**
    // 状态，不在 PipelineRunPhase 枚举（Pending/Running/WaitingApproval/
    // Succeeded/Failed/Cancelled）里。要按它筛列表必须逐 run 拉
    // GET /runs/:id/tasks（N+1），所以在 hub 提供
    // GET /releases?scope=global&state=paused 之前不提供该筛选项。
    filters: [
      { value: '', label: '全部' },
      { value: 'Running', label: '进行中' },
      { value: 'WaitingApproval', label: '待审批' },
      { value: 'Succeeded', label: '成功' },
      { value: 'Failed', label: '失败' },
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

/** 深链来的 phase 是否属于当前视图 —— 不属于就丢弃（避免 ?view=pipelines&phase=Failed 这种混搭残留）。 */
export function isValidRunFilter(key: unknown, value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return true
  return getRunView(key).filters.some((f) => f.value === value)
}

// ---------------------------------------------------------------------------
// URL 契约：三视图的 query 只有一种合法形态（附 B 硬约束 ①③）。
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
