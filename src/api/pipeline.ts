import { http } from './http'
import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

// 三态任务模型（与 hub PipelineTaskTemplate / runnerapi.PipelineTaskType 对齐）。
// Build=命令型(构建/测试) · Release=声明式施加软件单元(chart/manifest) · Approval=人工卡点。
export type PipelineTaskType = 'Build' | 'Release' | 'Approval'

export interface Pipeline {
  id: string
  componentId: string
  name: string
  kind: 'build' | 'release' | 'custom'
  description?: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface PipelineStage {
  id: string
  pipelineId: string
  name: string
  sequence: number
}

// Release 类型：声明式施加一个软件单元。chart 与 manifest 二选一。
export interface ReleaseConfig {
  chart?: {
    repo?: string // helm repo URL
    name?: string // chart 名称
    version?: string // chart 版本
    chartUrl?: string // 或直接使用 chart 包 URL
  }
  values?: Record<string, string> // 注入 values（可引用参数管理 key）
  manifest?: string // kubectl apply 的 YAML 内容
}

// Approval 类型：审批卡点配置（按后端 ApprovalConfig 结构补全）。
export interface ApprovalConfig {
  description?: string
  [key: string]: unknown
}

export interface PipelineTaskTemplate {
  id: string
  stageId: string
  name: string
  type: PipelineTaskType
  displayOrder: number
  image?: string
  // Build 类型：内联命令（优先于 scriptPath）。例如 command=["pytest"], args=["-q"]
  command?: string[]
  args?: string[]
  // 脚本逃生通道（可选，Build 类型下可不放脚本）
  scriptPath?: string
  scriptArgs?: string[]
  produces?: string[]
  consumes?: string[]
  // Release 类型配置
  releaseConfig?: ReleaseConfig
  // Approval 类型配置
  approvalConfig?: ApprovalConfig
  timeoutSeconds: number
}

const crud = createCrud<Pipeline>('/pipelines')

export const pipelineApi = {
  ...crud,
  listByComponent: (componentId: string, p?: Pagination) =>
    listPaged<Pipeline>(`/components/${componentId}/pipelines`, p),

  // ---- stages ----
  createStage: (pipelineId: string, payload: Partial<PipelineStage>) =>
    http.post<{ data: PipelineStage }>(`/pipelines/${pipelineId}/stages`, payload).then((r) => r.data.data),
  listStages: (pipelineId: string) =>
    http.get<{ data: PipelineStage[] }>(`/pipelines/${pipelineId}/stages`).then((r) => r.data.data),
  deleteStage: (id: string) => http.delete(`/stages/${id}`),

  // ---- task templates ----
  createTask: (stageId: string, payload: Partial<PipelineTaskTemplate>) =>
    http.post<{ data: PipelineTaskTemplate }>(`/stages/${stageId}/tasks`, payload).then((r) => r.data.data),
  listTasks: (stageId: string) =>
    http.get<{ data: PipelineTaskTemplate[] }>(`/stages/${stageId}/tasks`).then((r) => r.data.data),
  updateTask: (id: string, payload: Partial<PipelineTaskTemplate>) =>
    http.put<{ data: PipelineTaskTemplate }>(`/tasks/${id}`, payload).then((r) => r.data.data),
  deleteTask: (id: string) => http.delete(`/tasks/${id}`),
}
