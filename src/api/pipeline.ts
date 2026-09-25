import { http } from './http'
import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'
import type { DerivedTaskType, StageExecutionMode } from '@/utils/pipeline'

// 三态任务模型（与 hub PipelineTaskTemplate / runnerapi.PipelineTaskType 对齐）。
// Build=命令型(构建/测试) · Release=声明式施加软件单元(chart/manifest) · Approval=人工卡点。
//
// ⚠️ 这是**内部派发码**，不是用户可选的分类（§7.4 拍板）：编辑器只显示产品语言
// （「构建 / 运行任务」「发布任务」「人工审核阶段」），`type` 由配置派生 ——
// 派生规则在 utils/pipeline.ts 的 deriveTaskType()/taskNature()，此处只做别名。
export type PipelineTaskType = DerivedTaskType

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
  // 阶段内子任务并行 / 串行（hub pipeline_stages.execution_mode，migrations/0010）。
  // ⚠️ 只做 API ↔ DB 往返：runner 侧**尚未**按 serial 串行调度（backlog C-06），
  // 故 UI 文案不得声称「串行执行已生效」。
  executionMode: StageExecutionMode
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

// 重试策略（runnerapi.RetryPolicy）。maxRetries=0 表示不重试。
export interface RetryPolicy {
  maxRetries?: number
  backoff?: string // 如 "30s"；留空 = 立即重试
}

// 审批卡点配置（runnerapi.ApprovalConfig）。
// ⚠️ 字段名与 runner 保持严格一致 —— 这层 JSON 会被直接拷进 PipelineTaskSpec。
export interface ApprovalConfig {
  /** 需要几名不同审批人通过（runner 侧 Minimum=1）。 */
  requiredApprovals?: number
  /** 允许的审批人（邮箱 / 用户 ID，由 hub 校验）。留空 = 有项目权限者均可。 */
  allowedApprovers?: string[]
  /** 超时未决策即自动失败；0 = 无限等待。 */
  timeoutSeconds?: number
  /** console 侧补充的自由说明（非 runner 字段）。 */
  description?: string
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
  // 重试策略（Build / Release 均可带）
  retryPolicy?: RetryPolicy
  // 金丝雀 / 渐进式发布（Release 类型，序列化为 runner 的 RolloutSpec）
  rolloutConfig?: Record<string, unknown>
  timeoutSeconds: number
}

const crud = createCrud<Pipeline>('/pipelines')

// ---------------------------------------------------------------------------
// 版本历史 / 对比 / 回滚（C-09，与 hub internal/pipeline/models/version.go 对齐）
// ---------------------------------------------------------------------------

/** 列表视图的版本摘要（**不含**快照体 —— 体可能很大，列表不搬它）。 */
export interface PipelineVersionSummary {
  version: number
  createdBy?: string
  createdAt: string
  stages: number
  tasks: number
  /** 与上一版（更老的那一版）的体是否完全相同。**缺省 = 未知**（上一版不在本次窗口内），
   *  不是 false —— 把"未知"渲染成"有变化"会凭空吓人。 */
  identicalToPrevious?: boolean
  isCurrent: boolean
}

/** 快照体（hub models.Snapshot）。只用于"看某一版长什么样"。 */
export interface PipelineVersionSnapshot {
  pipelineId: string
  name: string
  kind: string
  description?: string
  stages: {
    name: string
    sequence: number
    executionMode: string
    tasks: { name: string; type: string; displayOrder: number; image?: string }[]
  }[]
}

export interface PipelineVersionRow {
  id: string
  pipelineId: string
  version: number
  snapshot: PipelineVersionSnapshot
  createdBy?: string
  createdAt: string
}

export type VersionChange = 'added' | 'removed' | 'modified'

export interface VersionFieldChange {
  field: string
  from: string
  to: string
}

export interface VersionStageDiff {
  name: string
  change: VersionChange
  fields?: VersionFieldChange[]
}

export interface VersionTaskDiff {
  stage: string
  name: string
  change: VersionChange
  fields?: VersionFieldChange[]
}

export interface VersionDiffSummary {
  stagesAdded: number
  stagesRemoved: number
  stagesModified: number
  tasksAdded: number
  tasksRemoved: number
  tasksModified: number
}

export interface PipelineVersionDiff {
  fromVersion: number
  toVersion: number
  fromCreatedAt: string
  toCreatedAt: string
  stages: VersionStageDiff[]
  tasks: VersionTaskDiff[]
  summary: VersionDiffSummary
  identical: boolean
}

export interface VersionRollbackResult {
  pipelineId: string
  restoredVersion: number
  newVersion: number
  stages: number
  tasks: number
}

export const pipelineApi = {
  ...crud,
  // 全局流水线列表：P0-2 已落地（hub GET /pipelines）。替代原先前端「组织→服务→组件→流水线」
  // 四级遍历聚合（useResourceMap.buildResourceIndex 的 stopgap）。M1 规模下默认拉一页足够，
  // 真超量再翻页遍历。
  listGlobal: (p?: Pagination) => listPaged<Pipeline>('/pipelines', p),
  listByComponent: (componentId: string, p?: Pagination) =>
    listPaged<Pipeline>(`/components/${componentId}/pipelines`, p),

  // ---- stages ----
  createStage: (pipelineId: string, payload: Partial<PipelineStage>) =>
    http.post<{ data: PipelineStage }>(`/pipelines/${pipelineId}/stages`, payload).then((r) => r.data.data),
  listStages: (pipelineId: string) =>
    http.get<{ data: PipelineStage[] }>(`/pipelines/${pipelineId}/stages`).then((r) => r.data.data),
  updateStage: (id: string, payload: Partial<PipelineStage>) =>
    http.put<{ data: PipelineStage }>(`/stages/${id}`, payload).then((r) => r.data.data),
  deleteStage: (id: string) => http.delete(`/stages/${id}`),

  // ---- task templates ----
  createTask: (stageId: string, payload: Partial<PipelineTaskTemplate>) =>
    http.post<{ data: PipelineTaskTemplate }>(`/stages/${stageId}/tasks`, payload).then((r) => r.data.data),
  listTasks: (stageId: string) =>
    http.get<{ data: PipelineTaskTemplate[] }>(`/stages/${stageId}/tasks`).then((r) => r.data.data),
  updateTask: (id: string, payload: Partial<PipelineTaskTemplate>) =>
    http.put<{ data: PipelineTaskTemplate }>(`/tasks/${id}`, payload).then((r) => r.data.data),
  deleteTask: (id: string) => http.delete(`/tasks/${id}`),

  // ---- definition versions（C-09）----
  // 列表不带 limit：hub 默认 50、上限 200，超限是 400 而不是静默夹取。
  listVersions: (pipelineId: string) =>
    http
      .get<{ data: PipelineVersionSummary[] }>(`/pipelines/${pipelineId}/versions`)
      .then((r) => r.data.data),
  getVersion: (pipelineId: string, version: number) =>
    http
      .get<{ data: PipelineVersionRow }>(`/pipelines/${pipelineId}/versions/${version}`)
      .then((r) => r.data.data),
  /** 以 `against` 为基准，看 `version` 改了什么（方向性：基准在前、目标在后）。 */
  diffVersions: (pipelineId: string, version: number, against: number) =>
    http
      .get<{ data: PipelineVersionDiff }>(`/pipelines/${pipelineId}/versions/${version}/diff`, {
        params: { against },
      })
      .then((r) => r.data.data),
  rollbackVersion: (pipelineId: string, version: number) =>
    http
      .post<{ data: VersionRollbackResult }>(`/pipelines/${pipelineId}/versions/${version}/rollback`)
      .then((r) => r.data.data),
}
