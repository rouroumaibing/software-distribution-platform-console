// 运行控制纯逻辑（无 http / 无 store 依赖）——与 hub 侧 CancelRun / RerunTask 的
// 相位策略逐字对齐。抽成 utils 是为了让 node 冒烟能直接 import 源码 .ts
// （与 scripts/agent-op-smoke.mjs 同一手法）。
//
// 权威判定始终在后端：POST /runs/:id/cancel 对终态 run 返回 409
// （hub internal/run/service/run_control.go ErrRunTerminal）。这里只决定前端
// 是否给出入口，避免渲染「点了必然失败」的按钮。
import type { PipelineRunPhase, TaskRunPhase } from '../api/run'

/** 可取消的运行相位：仍在推进、尚未到终态。 */
const CANCELLABLE_RUN_PHASES: readonly string[] = ['Pending', 'Running', 'WaitingApproval']

/** 运行是否可被取消（非终态）。 */
export function isRunCancellable(phase: PipelineRunPhase): boolean {
  return CANCELLABLE_RUN_PHASES.includes(phase)
}

/** 运行是否已到终态（Succeeded / Failed / Cancelled）——终态不可取消。 */
export function isRunTerminal(phase: PipelineRunPhase): boolean {
  return !isRunCancellable(phase)
}

/** 可单任务重跑的任务相位：失败或被跳过才需要重跑。 */
const RERUNNABLE_TASK_PHASES: readonly string[] = ['Failed', 'Skipped']

/** 任务是否应提供「重跑（含下游）」入口。 */
export function isTaskRerunnable(phase: TaskRunPhase): boolean {
  return RERUNNABLE_TASK_PHASES.includes(phase)
}
