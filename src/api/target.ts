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

/** Runner 安装引导数据（ADR-0002，POST /targets/:id/join-bundle）。 */
export interface JoinBundle {
  targetName: string
  gatewayUrl: string
  apiBaseUrl: string
  caPem: string
  /** RFC7469 SPKI SHA256（kubeadm 同款 sha256:<hex>）。 */
  caFingerprint: string
  enrollToken: string
  expiresIn: string
  runnerVersion: string
}

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
  // Runner 安装引导包（ADR-0002）：URL + CA + 指纹 + per-target enrollToken，
  // 供 console 展示 join-command / 装机管线消费。501 = hub 未配置对外地址或 CA。
  joinBundle: (id: string) =>
    http.post<{ data: JoinBundle }>(`/targets/${encodeURIComponent(id)}/join-bundle`).then((r) => r.data.data),
}
