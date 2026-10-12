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
  // §6.2 安全与合规字段（S-2 双通道：外部扫描器经 scan-result 回写）
  scanStatus?: 'unscanned' | 'scanning' | 'scanned'
  signed?: boolean
  signature?: string
  sbomSummary?: string
  sevCritical?: number
  sevHigh?: number
  sevMedium?: number
  sevLow?: number
}

export interface ArtifactSearchFilter {
  version?: string
  name?: string
  componentId?: string
  type?: string
  since?: string
  until?: string
  scanStatus?: string
  signed?: string
  page?: number
  pageSize?: number
}

export const artifactApi = {
  listByComponent: (componentId: string, p?: Pagination) =>
    listPaged<Artifact>(`/components/${componentId}/artifacts`, p),

  // §6.2 跨组件检索（服务树第二视图数据源）
  search: (f: ArtifactSearchFilter) =>
    http
      .get<{ data: Artifact[]; total: number }>('/artifacts', { params: f })
      .then((r) => r.data),

  get: (id: string) => http.get<{ data: Artifact }>(`/artifacts/${id}`).then((r) => r.data.data),

  // 后端返回的是一个短时效的签名 URL,不是直接把文件流给前端。
  getDownloadUrl: (id: string) =>
    http.get<{ data: { url: string } }>(`/artifacts/${id}/download`).then((r) => r.data.data.url),

  remove: (id: string) => http.delete(`/artifacts/${id}`),
}
