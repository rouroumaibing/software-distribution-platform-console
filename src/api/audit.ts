import { http } from './http'

// 审计日志读端点（STATUS #19，hub GET /audit-logs 消费端）。
// 写入由 hub AuditMiddleware 独占（业务 handler 从不直写）；读端点挂
// platformGroup —— 开鉴权后要求平台级 user:manage，403 = 无平台权限，
// 由 http 拦截器统一跳 Forbidden 页。
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
  result: 'success' | 'failure'
  statusCode: number
  detail?: string
}

export interface AuditLogFilter {
  subject?: string
  actionPrefix?: string
  resourceType?: string
  resourceId?: string
  /** RFC3339，含下界 */
  since?: string
  /** RFC3339，含上界 */
  until?: string
  /** 1..500，默认 100（hub 仓储层同样钳制） */
  limit?: number
}

function clean(f: AuditLogFilter): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.subject) out.subject = f.subject
  if (f.actionPrefix) out.actionPrefix = f.actionPrefix
  if (f.resourceType) out.resourceType = f.resourceType
  if (f.resourceId) out.resourceId = f.resourceId
  if (f.since) out.since = f.since
  if (f.until) out.until = f.until
  if (f.limit) out.limit = String(f.limit)
  return out
}

export const auditApi = {
  list: (f: AuditLogFilter = {}) =>
    http.get<{ data: AuditLog[] }>('/audit-logs', { params: clean(f) }).then((r) => r.data.data ?? []),
}
