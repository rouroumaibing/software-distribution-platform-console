import { http } from './http'
import type { Envelope, PagedData, Pagination } from './http'
import { useAuthStore } from '@/stores/auth'
import {
  agentOpStatusLabel,
  agentOpTypeLabel,
  decodeOpEvent,
  isTerminalStatus,
  parseSSERawEvent,
  type AgentOp,
  type AgentOpLog,
  type AgentOpStatus,
  type AgentOpType,
  type OpEvent,
} from '@/utils/agentOp'

export type { AgentOp, AgentOpLog, AgentOpStatus, AgentOpType, OpEvent }
export { agentOpStatusLabel, agentOpTypeLabel, isTerminalStatus, parseSSERawEvent, decodeOpEvent }

export const agentOpApi = {
  get(id: string) {
    return http.get<Envelope<AgentOp>>(`/agent-ops/${id}`).then((r) => r.data.data as AgentOp)
  },
  listByTarget(targetId: string, p?: Pagination) {
    return http
      .get<Envelope<PagedData<AgentOp>>>(`/targets/${targetId}/agent-ops`, { params: p })
      .then((r) => r.data.data as PagedData<AgentOp>)
  },
  // 直连执行（§9.5）：command 与 script 至少填一个。
  exec(envId: string, body: { command?: string; script?: string }) {
    return http.post<Envelope<AgentOp>>(`/environments/${envId}/exec`, body).then((r) => r.data.data as AgentOp)
  },
  // 接入编排（§9.9）：向目标排队一次 runner 安装 / 升级（版本取版本矩阵）。
  install(targetId: string) {
    return http.post<Envelope<AgentOp>>(`/targets/${targetId}/install`).then((r) => r.data.data as AgentOp)
  },
  upgrade(targetId: string) {
    return http.post<Envelope<AgentOp>>(`/targets/${targetId}/upgrade`).then((r) => r.data.data as AgentOp)
  },
}

export interface StreamHandlers {
  onStatus?: (op: AgentOp) => void
  onLog?: (log: AgentOpLog) => void
  onEnd?: () => void
  onError?: (err: unknown) => void
}

// SSE 消费端（GET /agent-ops/:id/stream）。
// hub 鉴权只读 Authorization 头（middleware/auth.go），EventSource 无法带头，
// 故用 fetch 流式读取 + 手动解析；auth OFF（dev SKIP_AUTH=1）时 token 为空也能用。
// 解析逻辑在 utils/agentOp.ts（纯函数，供 node 冒烟直接测）。

// 流式订阅单个 op 的输出与状态变更。返回 AbortController 以便组件卸载时取消。
export function streamAgentOp(id: string, handlers: StreamHandlers): AbortController {
  const ctrl = new AbortController()
  const token = useAuthStore().accessToken
  const base = (http.defaults.baseURL || '/api/v1').replace(/\/$/, '')
  const url = `${base}/agent-ops/${id}/stream`

  void (async () => {
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        handlers.onError?.(new Error(`stream http ${res.status}`))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      // 累积 buffer，按 SSE 块分隔（\n\n）切分；末尾不足一块的保留到下次。
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const parsed = parseSSERawEvent(block)
          if (!parsed) continue
          if (parsed.event === 'end') {
            handlers.onEnd?.()
            return
          }
          const ev = decodeOpEvent(parsed.event, parsed.data)
          if (!ev) continue
          if (ev.kind === 'status') handlers.onStatus?.(ev.status!)
          else if (ev.kind === 'log') handlers.onLog?.(ev.log!)
        }
      }
      handlers.onEnd?.()
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      handlers.onError?.(err)
    }
  })()

  return ctrl
}
