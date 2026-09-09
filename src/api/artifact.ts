import { http } from './http'
import { listPaged } from './crud'
import type { Pagination } from './http'

export interface Artifact {
  id: string
  componentId: string
  pipelineRunId?: string
  taskRunId?: string
  version: string
  artifactType: 'image' | 'binary' | 'archive' | 'generic'
  storageKey: string
  sizeBytes?: number
  checksum?: string
  commitSha?: string
  expiresAt?: string
  createdAt: string
}

export const artifactApi = {
  listByComponent: (componentId: string, p?: Pagination) =>
    listPaged<Artifact>(`/components/${componentId}/artifacts`, p),

  get: (id: string) => http.get<{ data: Artifact }>(`/artifacts/${id}`).then((r) => r.data.data),

  // 后端返回的是一个短时效的签名 URL,不是直接把文件流给前端。
  getDownloadUrl: (id: string) =>
    http.get<{ data: { url: string } }>(`/artifacts/${id}/download`).then((r) => r.data.data.url),

  remove: (id: string) => http.delete(`/artifacts/${id}`),
}
