import { http } from './http'
import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

export interface Component {
  id: string
  serviceId: string
  key: string
  name: string
  repoUrl: string
  defaultBranch: string
  repoSecretRef?: string
  language?: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface ComponentConfig {
  id: string
  componentId: string
  environmentId?: string
  key: string
  value?: string
  isSecret: boolean
  secretRef?: string
  description?: string
  createdAt: string
  updatedAt: string
}

const crud = createCrud<Component>('/components')

export const componentApi = {
  ...crud,
  listByService: (serviceId: string, p?: Pagination) =>
    listPaged<Component>(`/services/${serviceId}/components`, p),

  // 配置管理走的是 upsert 语义(PUT 到具体的 key),不是标准 create/update。
  listConfigs: (componentId: string, environmentId?: string, p?: Pagination) =>
    http
      .get(`/components/${componentId}/configs`, { params: { environmentId, ...p } })
      .then((r) => r.data.data),

  upsertConfig: (componentId: string, key: string, payload: Partial<ComponentConfig>) =>
    http
      .put<{ data: ComponentConfig }>(`/components/${componentId}/configs/${key}`, payload)
      .then((r) => r.data.data),

  deleteConfig: (componentId: string, key: string) =>
    http.delete(`/components/${componentId}/configs/${key}`),
}
