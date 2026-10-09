import { http } from './http'
import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

export interface Target {
  id: string
  name: string
  vendor: string
  region: string
  /** 目标类型（hub TargetKindK8s/TargetKindHost，默认 k8s）。 */
  targetKind: 'k8s' | 'host'
  status: 'online' | 'offline'
  agentVersion?: string
  lastHeartbeatAt?: string
  createdAt: string
}

const crud = createCrud<Target>('/targets')

export const targetApi = {
  ...crud,
  list: (p?: Pagination) => listPaged<Target>('/targets', p),
  // 一次性 Runner 注册令牌（hub 契约 POST /targets/:id/enroll-token，24h 有效）。
  // Runner Agent 用它向 hub 完成首次回连注册；仅创建目标后需要，重复申请会作废旧 token。
  enrollToken: (id: string) =>
    http
      .post<{ data: { targetId: string; enrollToken: string; expiresIn: string } }>(
        `/targets/${encodeURIComponent(id)}/enroll-token`,
      )
      .then((r) => r.data.data),
}
