// 触发器配置 API（ui-12 §4.3 / N-21）：cron / webhook / event 三型。
// 全部 pipeline 作用域；webhook token 仅 create/rotate 响应返回一次。
import { http } from './http'
import { listPaged } from './crud'
import type { Pagination } from './http'

export type TriggerType = 'cron' | 'webhook' | 'event'

export interface TriggerSpec {
  // cron: 5 段标准表达式（分 时 日 月 周）
  expr?: string
  // event: 上游流水线 + 状态过滤（缺省 ["Succeeded"]）
  onPipelineId?: string
  statuses?: string[]
}

export interface PipelineTrigger {
  id: string
  pipelineId: string
  name: string
  type: TriggerType
  enabled: boolean
  spec?: TriggerSpec
  tokenPrefix?: string // webhook：wh_XXXXXXXX（仅前缀提示）
  lastTriggeredAt?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface CronPreviewResult {
  next: string[] // RFC3339，未来 5 次
}

export const triggerApi = {
  list: (pipelineId: string, p?: Pagination) =>
    listPaged<PipelineTrigger>(`/pipelines/${pipelineId}/triggers`, p),

  create: (pipelineId: string, payload: { name: string; type: TriggerType; enabled?: boolean; spec?: TriggerSpec }) =>
    http
      .post<{ data: PipelineTrigger; token?: string }>(`/pipelines/${pipelineId}/triggers`, payload)
      .then((r) => ({ trigger: r.data.data, token: r.data.token ?? '' })),

  update: (pipelineId: string, triggerId: string, payload: { name?: string; enabled: boolean; spec?: TriggerSpec }) =>
    http
      .put<{ data: PipelineTrigger }>(`/pipelines/${pipelineId}/triggers/${triggerId}`, payload)
      .then((r) => r.data.data),

  remove: (pipelineId: string, triggerId: string) =>
    http.delete(`/pipelines/${pipelineId}/triggers/${triggerId}`),

  rotate: (pipelineId: string, triggerId: string) =>
    http
      .post<{ data: { token: string } }>(`/pipelines/${pipelineId}/triggers/${triggerId}/rotate`)
      .then((r) => r.data.data.token),

  // 非法表达式服务端 400 报错；合法返回未来 5 次触发时刻。
  cronPreview: (pipelineId: string, expr: string) =>
    http
      .post<{ data: CronPreviewResult }>(`/pipelines/${pipelineId}/triggers-preview`, { expr })
      .then((r) => r.data.data),
}
