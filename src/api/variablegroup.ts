// 共享变量组（ui-12 §5.3，N-26）：org 级变量组 CRUD + 组件绑定。
import { http, type Envelope } from './http'

export interface VariableEntry {
  key: string
  value?: string
  description?: string
}

export interface VariableGroup {
  id: string
  orgId: string
  name: string
  description?: string
  variables: VariableEntry[] | string // hub 以 JSON 存储；消费端自行归一
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface VariableGroupBinding {
  id: string
  componentId: string
  groupId: string
  priority: number
  createdBy?: string
  createdAt: string
}

/** 组变量体归一：hub 存 JSON 字符串或数组，消费端统一为数组。 */
export function groupEntries(g: VariableGroup): VariableEntry[] {
  if (Array.isArray(g.variables)) return g.variables
  try {
    return JSON.parse((g.variables as string) || '[]')
  } catch {
    return []
  }
}

export const variableGroupApi = {
  listByOrg: (orgId: string) =>
    http
      .get<Envelope<VariableGroup[]>>(`/orgs/${encodeURIComponent(orgId)}/variable-groups`)
      .then((r) => r.data.data ?? []),

  create: (body: { orgId: string; name: string; description?: string; variables: VariableEntry[] }) =>
    http.post<Envelope<VariableGroup>>('/variable-groups', body).then((r) => r.data.data),

  update: (id: string, body: { name: string; description?: string; variables: VariableEntry[] }) =>
    http.put<Envelope<VariableGroup>>(`/variable-groups/${id}`, body).then((r) => r.data.data),

  remove: (id: string) => http.delete(`/variable-groups/${id}`),

  listBindings: (componentId: string) =>
    http
      .get<Envelope<VariableGroupBinding[]>>(`/components/${encodeURIComponent(componentId)}/variable-group-bindings`)
      .then((r) => r.data.data ?? []),

  bind: (componentId: string, groupId: string, priority = 100) =>
    http
      .post<Envelope<unknown>>(`/components/${encodeURIComponent(componentId)}/variable-group-bindings`, {
        groupId,
        priority,
      })
      .then((r) => r.data.data),

  unbind: (bindingId: string) => http.delete(`/variable-group-bindings/${bindingId}`),
}
