// 制品/发布视图消费端：GET /releases（ReleaseHandler）。
// 灰度回流（RUNNER-REFLUX-SPEC §3）落地后，release 行的 currentWeight 是
// runner 上报的真实灰度快照（hub 落 rollout_runs），不再是任务完成数近似。
import { http, type Envelope, type PagedData } from './http'

export interface RolloutRun {
  id: string
  taskRunId: string
  workloadRef: string
  phase: string // Progressing | Paused | Healthy | Degraded | RollingBack
  currentStepIndex: number
  currentWeight: number
  stepHistory?: Array<{ at: string; phase: string; weight: number }>
  startTime?: string
  completionTime?: string
}

export const releaseApi = {
  /** 按流水线运行查灰度快照行（发布视图轮询用）。 */
  listByRun: (pipelineRunId: string) =>
    http
      .get<Envelope<PagedData<RolloutRun>>>('/releases', {
        params: { pipelineRunId, scope: 'global', page: 1, pageSize: 50 },
      })
      .then((r) => r.data.data?.items ?? []),
}
