import { http } from './http'
import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

// §7.12 环境对接配置：环境数据与 hub 侧环境模型对齐（access / accessConfig /
// status / groupId 均为后端新增字段，旧前端只有 targetId/namespace/envType）。
export type EnvAccess = 'agent' | 'kubeconfig' | 'ssh'
export type EnvType = 'test' | 'production'
export type EnvStatus =
  | 'unconfigured' // 未配置
  | 'configured_unverified' // 已配置·未验证
  | 'verified' // 验证通过
  | 'failed' // 验证失败

export interface SSHEntry {
  host: string
  port?: number
  user: string
  authType?: 'password' | 'key'
  secretRef?: string
  bastion?: string
}

// 接入方式相关的非敏感配置（敏感凭据只存引用，见 §7.12.4）。
export interface EnvAccessConfig {
  kubeSource?: 'ref' | 'paste' | 'manual' // 凭据来源三选一
  kubeCredRef?: string // 引用凭据库中的一条 kubeconfig 凭据 id
  kubeServer?: string // 手工填写的 apiserver 地址（非敏感）
  kubeInsecureSkipTLS?: boolean
  kubeCurrentContext?: string
  kubeDefaultNS?: string
  sshSecretRef?: string // 引用凭据库中的一条 ssh 凭据 id
  sshSudo?: boolean
  sshTargets?: SSHEntry[]
}

export interface Environment {
  id: string
  componentId: string
  key: string
  name: string
  targetId: string
  envType: EnvType
  namespace: string
  // —— §7.12 新增 ——
  access: EnvAccess
  groupId?: string
  accessConfig?: EnvAccessConfig
  status: EnvStatus
  lastTestAt?: string
  lastTestResult?: string // JSON 字符串，前端解析为 TestReport
  createdAt: string
  updatedAt?: string
}

// POST /environments/:id/test 的返回形状（§7.12.5 逐项 checklist）。
export interface TestItem {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail?: string
}

export interface TestReport {
  access: EnvAccess
  items: TestItem[]
  passed: number
  total: number
  status: EnvStatus
  testedAt: string
}

// 凭据库（§7.12.3/§7.12.4）：明文只入不回显，读取一律返回 valueSet。
export interface Credential {
  id: string
  name: string
  type: 'kubeconfig' | 'ssh-key' | 'ssh-password' | 'basic'
  scope?: string
  scopeId?: string
  valueSet: boolean // 是否已配置凭据（永远不返回明文）
  createdAt: string
  updatedAt: string
}

export interface KubeParseResult {
  server: string
  caPresent: boolean
  insecureSkipTLS: boolean
  authMethod: 'token' | 'client-cert' | 'basic' | 'none'
  currentContext: string
  defaultNamespace: string
  errors: string[]
}

// 环境分组（§7.3/§7.12）：组件下的环境归类，可为空（ungrouped 是合法状态）。
export interface EnvironmentGroup {
  id: string
  componentId: string
  name: string
  description?: string
  orderIndex: number
  createdAt: string
}

function httpPost<T>(path: string, payload?: unknown) {
  return http.post<{ data: T }>(path, payload).then((r) => r.data.data as T)
}

function httpPut<T>(path: string, payload?: unknown) {
  return http.put<{ data: T }>(path, payload).then((r) => r.data.data as T)
}

const crud = createCrud<Environment>('/environments')

export const environmentApi = {
  ...crud,
  listByComponent: (componentId: string, p?: Pagination) =>
    listPaged<Environment>(`/components/${componentId}/environments`, p),
  // 逐项连接测试（§7.12.5），返回维度清单并持久化到环境状态机。
  test: (id: string) => httpPost<TestReport>(`/environments/${id}/test`),
}

export const credentialApi = {
  list: (scope?: string, scopeId?: string, p?: Pagination) => {
    const q: Record<string, string> = {}
    if (scope) q.scope = scope
    if (scopeId) q.scopeId = scopeId
    return listPaged<Credential>('/credentials', p, q)
  },
  create: (payload: { name: string; type: string; scope?: string; scopeId?: string; value: string }) =>
    httpPost<Credential>('/credentials', payload),
  // 粘贴 kubeconfig 后做结构预览（权威校验仍由 hub 侧完成）。
  parseKubeconfig: (raw: string) => httpPost<KubeParseResult>('/credentials/parse-kubeconfig', { raw }),
}

export const environmentGroupApi = {
  listByComponent: (componentId: string, p?: Pagination) =>
    listPaged<EnvironmentGroup>(`/components/${componentId}/environment-groups`, p),
  create: (payload: { componentId: string; name: string; description?: string; orderIndex?: number }) =>
    httpPost<EnvironmentGroup>('/environment-groups', payload),
  update: (id: string, payload: Partial<EnvironmentGroup>) =>
    httpPut<EnvironmentGroup>(`/environment-groups/${id}`, payload),
  remove: (id: string) => http.delete(`/environment-groups/${id}`),
}

// §7.12.6 环境状态机 → 树/面板上的状态点 + 文案。
// 注意：未配置 与 已配置·未验证 在文档里都用「灰 unknown 点」，但文案不同。
export const ENV_STATUS_META: Record<EnvStatus, { label: string; dot: string }> = {
  unconfigured: { label: '未配置', dot: '#9aa0a6' },
  configured_unverified: { label: '已配置·未验证', dot: '#9aa0a6' },
  verified: { label: '验证通过', dot: '#1e8e3e' },
  failed: { label: '验证失败', dot: '#b06000' },
}

export const ENV_ACCESS_LABEL: Record<EnvAccess, string> = {
  agent: 'Agent 回连（推荐）',
  kubeconfig: 'kubeconfig 直连',
  ssh: 'SSH 直连（非容器目标）',
}
