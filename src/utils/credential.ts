// 凭据纯逻辑（无 http / store 依赖）—— 枚举与 hub credentials/models 逐字对齐。
// 抽成 utils 是为让 node 冒烟直接 import 源码 .ts。

export type CredentialType = 'kubeconfig' | 'ssh-key' | 'ssh-password' | 'basic'
export type CredentialScope = 'target' | 'environment'

export interface CredentialDTO {
  id: string
  name: string
  type: CredentialType
  scope?: CredentialScope
  scopeId?: string
  valueSet: boolean
  createdAt: string
  updatedAt: string
}

export interface CredentialInput {
  name: string
  type: CredentialType
  scope?: CredentialScope
  scopeId?: string
  value?: string
}

export const CREDENTIAL_TYPE_LABEL: Record<CredentialType, string> = {
  kubeconfig: 'Kubeconfig',
  'ssh-key': 'SSH 密钥',
  'ssh-password': 'SSH 密码',
  basic: '基础认证',
}

export const CREDENTIAL_SCOPE_LABEL: Record<CredentialScope, string> = {
  target: '目标',
  environment: '环境',
}

export const CREDENTIAL_TYPE_OPTIONS: CredentialType[] = ['kubeconfig', 'ssh-key', 'ssh-password', 'basic']
export const CREDENTIAL_SCOPE_OPTIONS: CredentialScope[] = ['target', 'environment']

export function credentialTypeLabel(t: CredentialType): string {
  return CREDENTIAL_TYPE_LABEL[t] ?? t
}

export function credentialScopeLabel(s?: CredentialScope): string {
  if (!s) return '全局'
  return CREDENTIAL_SCOPE_LABEL[s] ?? s
}
