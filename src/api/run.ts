import { http } from './http'
import { listPaged } from './crud'
import type { Pagination } from './http'
import type { PipelineTaskType } from './pipeline'

export type PipelineRunPhase =
  | 'Pending'
  | 'Running'
  | 'WaitingApproval'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'

export type TaskRunPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Skipped'

export interface PipelineRun {
  id: string
  pipelineId: string
  targetId: string
  crName: string
  crNamespace: string
  commitSha?: string
  pipelineVersion: number
  phase: PipelineRunPhase
  triggeredBy?: string
  startTime?: string
  completionTime?: string
  message?: string
  createdAt: string
}

export interface TaskRun {
  id: string
  pipelineRunId: string
  taskName: string
  stageName: string
  type: PipelineTaskType
  phase: TaskRunPhase
  retryCount: number
  exitCode?: number
  startTime?: string
  completionTime?: string
  logsRef?: string
  message?: string
}

// 单条流式子日志块(后端 task_run_logs 表,G2 端点落地)。
export interface TaskRunLog {
  id: string
  pipelineRunId: string
  taskName: string
  stream?: string // stdout | stderr
  chunk: string
  createdAt: string
}

// 运行参数(按 name/value 注入任务 command/args/env)。
export interface Param {
  name: string
  value: string
}

// 触发运行的请求体(与 hub TriggerRequest 对齐)。
export interface TriggerRequest {
  targetId?: string
  targetIds?: string[] // 多环境扇出,忽略 targetId
  targetNamespace?: string
  repoUrl?: string
  repoRef?: string
  repoPath?: string
  params?: Param[]
  commitSha?: string
  triggeredBy?: string
}

export const runApi = {
  // 触发运行:传接入目标/参数/代码源,DAG 由后端组装。
  // hub 契约:POST /pipelines/:id/runs 返回 {data: PipelineRun[]}(targetIds 扇出
  // 时一条请求可产多个 run,故恒为列表,e2e-smoke gotcha 实测)。取首元素;
  // 对象形状兜底,防御后端契约收紧。
  trigger: (pipelineId: string, payload: TriggerRequest) =>
    http
      .post<{ data: PipelineRun[] | PipelineRun }>(`/pipelines/${pipelineId}/runs`, payload)
      .then((r) => {
        const d = r.data.data
        return Array.isArray(d) ? d[0] : d
      }),

  get: (id: string) => http.get<{ data: PipelineRun }>(`/runs/${id}`).then((r) => r.data.data),

  listByPipeline: (pipelineId: string, p?: Pagination) =>
    listPaged<PipelineRun>(`/pipelines/${pipelineId}/runs`, p),

  // 全局运行列表（运行中心）：跨 pipeline 巡视，phase / componentId 均为可选过滤。
  // componentId 是流水线列表「最近运行」列要的：**一次**取回该组件下全部运行，
  // 客户端按 pipelineId 分组取最新 —— 否则每条流水线各打一次 → N+1。
  listAll: (p?: Pagination & { phase?: string; componentId?: string }) =>
    listPaged<PipelineRun>('/runs', p),

  listTasks: (runId: string) =>
    http.get<{ data: TaskRun[] }>(`/runs/${runId}/tasks`).then((r) => r.data.data),

  // 轻量进度轮询(高频):返回 { phase, message, tasks[] }。
  progress: (runId: string) =>
    http
      .get<{ data: { phase: PipelineRunPhase; message?: string; tasks: TaskRun[] } }>(
        `/runs/${runId}/progress`,
      )
      .then((r) => r.data.data),

  // 重新投递卡住/失败的运行。
  redispatch: (runId: string) =>
    http.post<{ data: unknown }>(`/runs/${runId}/redispatch`).then((r) => r.data.data),

  // 提交审批决策(Approval 类型任务暂停时)。
  approve: (
    pipelineId: string,
    runId: string,
    taskName: string,
    decision: { approved: boolean; reason?: string; approver?: string },
  ) =>
    http
      .post<{ data: unknown }>(
        `/pipelines/${pipelineId}/runs/${runId}/tasks/${taskName}/decision`,
        decision,
      )
      .then((r) => r.data.data),

  // 读取运行/任务日志(G2 端点 GET /runs/:id/log 或 /runs/:id/tasks/:name/log)。
  // 不传 taskName 读取运行级(__run__)日志。
  logs: (runId: string, taskName?: string, p?: Pagination) => {
    const path = taskName
      ? `/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskName)}/log`
      : `/runs/${encodeURIComponent(runId)}/log`
    return listPaged<TaskRunLog>(path, p ?? { page: 1, pageSize: 500 })
  },

  // Rollout 发布控制(G4 端点 POST /runs/:id/tasks/:name/rollout)。
  // action: pause(暂停在当前权重) | promote(晋升/推进下一步) | rollback(回滚到 0%)。
  rollout: (runId: string, taskName: string, action: 'pause' | 'promote' | 'rollback') =>
    http
      .post<{ data: unknown }>(`/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskName)}/rollout`, {
        action,
      })
      .then((r) => r.data.data),

  // 取消运行(POST /runs/:id/cancel)：停掉 Pending/Running/WaitingApproval 的 run，
  // Runner 会把它置为 Cancelled 并清掉在途 TaskRun。终态 run 后端返回 409。
  cancel: (runId: string) =>
    http.post<{ data: unknown }>(`/runs/${encodeURIComponent(runId)}/cancel`).then((r) => r.data.data),

  // 单任务重跑(POST /runs/:id/tasks/:name/rerun)：只重跑该任务及其下游，
  // 不重投整个 run —— 对应 Hub 侧 C-07（Runner 的 rerun handler 早已就绪）。
  rerunTask: (runId: string, taskName: string) =>
    http
      .post<{ data: unknown }>(
        `/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskName)}/rerun`,
      )
      .then((r) => r.data.data),
}
