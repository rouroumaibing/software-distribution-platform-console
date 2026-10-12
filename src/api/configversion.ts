// 组件配置版本化（ui-12 §4.1/§4.2，N-18/N-19）：整环境快照 + diff + 回滚。
// 密钥值在 hub 侧恒为掩码 "<secret>"，前端永不接触明文。
import { http, type Envelope } from './http'

export interface ConfigSnapshotEntry {
  key: string
  value?: string
  isSecret: boolean
  secretRef?: string
}

export interface ConfigSnapshot {
  id: string
  componentId: string
  environmentId?: string
  version: number
  comment?: string
  createdBy?: string
  createdAt: string
}

export interface ConfigSnapshotDetail {
  version: ConfigSnapshot
  entries: ConfigSnapshotEntry[]
}

export interface ConfigKeyDiff {
  key: string
  change: 'added' | 'removed' | 'modified'
  from?: string
  to?: string
}

export interface ConfigSnapshotDiff {
  fromVersion: number
  toVersion: number
  keys: ConfigKeyDiff[]
  summary: { added: number; removed: number; modified: number }
  identical: boolean
}

/** 快照 scope：environmentId 缺省 = 全局默认 scope。 */
function scopeParams(environmentId?: string) {
  return environmentId ? { environmentId } : {}
}

export const configVersionApi = {
  list: (componentId: string, environmentId?: string, limit = 50) =>
    http
      .get<Envelope<ConfigSnapshot[]>>(`/components/${encodeURIComponent(componentId)}/config-versions`, {
        params: { limit, ...scopeParams(environmentId) },
      })
      .then((r) => r.data.data ?? []),

  get: (componentId: string, version: number, environmentId?: string) =>
    http
      .get<Envelope<ConfigSnapshotDetail>>(
        `/components/${encodeURIComponent(componentId)}/config-versions/${version}`,
        { params: scopeParams(environmentId) },
      )
      .then((r) => r.data.data),

  diff: (componentId: string, a: number, b: number, environmentId?: string) =>
    http
      .get<Envelope<ConfigSnapshotDiff>>(
        `/components/${encodeURIComponent(componentId)}/config-versions/diff`,
        { params: { a, b, ...scopeParams(environmentId) } },
      )
      .then((r) => r.data.data),

  /** 回滚（高危，hub 强制 comment；reason/ticket 落审计）。生成新版本，历史不改写。 */
  rollback: (componentId: string, version: number, comment: string, ticket: string, environmentId?: string) =>
    http
      .post<Envelope<ConfigSnapshot>>(
        `/components/${encodeURIComponent(componentId)}/config-versions/${version}/rollback`,
        { comment, ticket: ticket || undefined },
        { params: scopeParams(environmentId) },
      )
      .then((r) => r.data.data),
}
