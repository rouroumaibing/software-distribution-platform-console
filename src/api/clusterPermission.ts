// 集群权限（ACCESS-CONTROL §7 / §8）：K8s RBAC 授权层管理端点。
// hub 侧 /api/v1/cluster-permissions/* —— 创建/列出/吊销/删除集群角色绑定，
// 以及 User 主体的 kubeconfig 签发（CSR）与轮换（吊销 = 换 subject）。
import { http, type Envelope } from './http'

export type ClusterSubjectKind = 'user' | 'group' | 'org'

export type ClusterRoleName = 'admin' | 'ops' | 'dev' | 'readonly' | 'custom'

export interface ClusterBinding {
  id: string
  environmentId: string
  subjectKind: ClusterSubjectKind
  subjectId: string
  subjectName: string
  role: ClusterRoleName
  clusterScoped: boolean
  namespace?: string
  resources?: string[]
  operations?: string[]
  status: 'active' | 'revoked'
  certHash?: string
  certSubject?: string
  createdAt: string
  updatedAt: string
}

export interface CreateClusterPermissionInput {
  environmentId: string
  subjectKind: ClusterSubjectKind
  subjectId: string
  subjectName: string
  role: ClusterRoleName
  clusterScoped: boolean
  namespace?: string
  resources?: string[]
  operations?: string[]
}

export interface CreateClusterPermissionResult {
  binding: ClusterBinding
  kubeconfig?: string
}

export const clusterPermissionApi = {
  list(): Promise<ClusterBinding[]> {
    return http
      .get<Envelope<{ items: ClusterBinding[] }>>('/cluster-permissions')
      .then((r) => r.data.data?.items ?? [])
  },
  get(id: string): Promise<ClusterBinding> {
    return http.get<Envelope<ClusterBinding>>(`/cluster-permissions/${id}`).then((r) => r.data.data!)
  },
  create(input: CreateClusterPermissionInput): Promise<CreateClusterPermissionResult> {
    return http
      .post<Envelope<CreateClusterPermissionResult>>('/cluster-permissions', input)
      .then((r) => r.data.data!)
  },
  revoke(id: string): Promise<{ binding: ClusterBinding; kubeconfig?: string }> {
    return http
      .post<Envelope<{ binding: ClusterBinding; kubeconfig?: string }>>(`/cluster-permissions/${id}/revoke`)
      .then((r) => r.data.data!)
  },
  remove(id: string): Promise<void> {
    return http.delete(`/cluster-permissions/${id}`).then(() => undefined)
  },
}
