// 审批中心 API（ui-12 §5.1）：GET /approvals 三视图 + 组件审批策略 CRUD。
import { http } from './http'

export interface CenterApproval {
  id: string
  orgId: string
  runId: string
  pipelineId?: string
  taskRunId?: string
  componentId: string
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'
  requestedBy: string
  approver?: string
  assignee?: string // JSON 数组字符串；空 = 任意审批人
  decisionComment?: string
  createdAt: string
  decidedAt?: string
}

export type CenterView = 'pending' | 'initiated' | 'decided'

export interface ApprovalPolicy {
  id?: string
  componentId: string
  environmentId?: string | null
  mode: 'any' | 'all' | 'n'
  minApprovals?: number
  assignees?: string // JSON 数组字符串，如 '["alice","bob"]'；'' = 不限
  timeoutSeconds?: number
  createdBy?: string
}

export const approvalApi = {
  center: (view: CenterView, limit = 50) =>
    http.get<{ data: CenterApproval[] }>('/approvals', { params: { view, limit } }).then((r) => r.data.data),

  listPolicies: (componentId: string) =>
    http.get<{ data: ApprovalPolicy[] }>(`/components/${componentId}/approval-policies`).then((r) => r.data.data),

  upsertPolicy: (componentId: string, payload: ApprovalPolicy) =>
    http.put<{ data: ApprovalPolicy }>(`/components/${componentId}/approval-policies`, payload).then((r) => r.data.data),
}

/** assignee JSON 数组字符串 → 名称列表（坏数据安全回落空数组）。 */
export function parseAssignees(raw?: string): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}
