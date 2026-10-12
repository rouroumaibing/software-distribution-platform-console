import { http } from './http'

// 审计日志读端点（STATUS #19 + ui-12 5.4 组件级审计下沉，hub GET /audit-logs
// 消费端）。写入由 hub AuditMiddleware 独占（业务 handler 从不直写）；读端点
// 双通道：平台管理员（user:manage）全量可查；组件管理员（component:manage）
// 须携带 componentId，hub 中间件+handler 双保险强制钳到该组件。403 = 无权限，
// 平台管理页走拦截器统一跳 Forbidden；组件审计 Tab 用 skip403Redirect 内联
// 呈现锁态（FIVES-STATES 锁图标态）。
export interface AuditLog {
  id: string
  timestamp: string
  subjectType?: string // user | group
  subject: string
  roles?: string
  sourceIP?: string
  action: string // e.g. component:create / approval.approve
  resourceType?: string
  resourceId?: string
  // 反规范化组件归属（组件管理员视图的过滤键）。
  componentId?: string
  result: 'success' | 'failure'
  statusCode: number
  detail?: string
  // 高危操作结构化审计上下文（ui-12 §4.4 / §5.4）。
  reason?: string
  ticket?: string
}

export interface AuditLogFilter {
  /** 反规范化组件归属过滤（组件级审计必带） */
  componentId?: string
  subject?: string
  actionPrefix?: string
  resourceType?: string
  resourceId?: string
  /** RFC3339，含下界 */
  since?: string
  /** RFC3339，含上界 */
  until?: string
  /** 变更单号精确匹配（hub ticket = ?） */
  ticket?: string
  /** 原因关键词 ILIKE（hub reason ILIKE %?%） */
  reason?: string
  /** 1..500，默认 100（hub 仓储层同样钳制） */
  limit?: number
}

function clean(f: AuditLogFilter): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.componentId) out.componentId = f.componentId
  if (f.subject) out.subject = f.subject
  if (f.actionPrefix) out.actionPrefix = f.actionPrefix
  if (f.resourceType) out.resourceType = f.resourceType
  if (f.resourceId) out.resourceId = f.resourceId
  if (f.since) out.since = f.since
  if (f.until) out.until = f.until
  if (f.ticket) out.ticket = f.ticket
  if (f.reason) out.reason = f.reason
  if (f.limit) out.limit = String(f.limit)
  return out
}

export const auditApi = {
  list: (f: AuditLogFilter = {}) =>
    http.get<{ data: AuditLog[] }>('/audit-logs', { params: clean(f) }).then((r) => r.data.data ?? []),
  /** 组件审计 Tab 专用：403 不跳 Forbidden 页，由调用方内联呈现锁态。 */
  listForComponent: (componentId: string, limit = 100) =>
    http
      .get<{ data: AuditLog[] }>('/audit-logs', {
        params: clean({ componentId, limit }),
        skip403Redirect: true,
      })
      .then((r) => r.data.data ?? []),
}
