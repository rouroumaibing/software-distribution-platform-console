// agent_ops 纯逻辑（无 http / 无 store 依赖）—— 与 hub target/models/agent_op.go 枚举逐字对齐。
// 抽成 utils 是为了让 node 冒烟能直接 import 源码 .ts（与 scripts/*.mjs 同一手法）。

export type AgentOpType = 'exec' | 'install' | 'upgrade'
export type AgentOpStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface AgentOp {
  id: string
  targetId: string
  envId?: string
  opType: AgentOpType
  status: AgentOpStatus
  detail?: string
  message?: string
  createdAt: string
  updatedAt: string
}

export interface AgentOpLog {
  id: string
  opId: string
  seq: number
  stream?: string // stdout | stderr
  chunk: string
  createdAt: string
}

export interface OpEvent {
  kind: 'status' | 'log'
  status?: AgentOp
  log?: AgentOpLog
}

const OP_TYPE_LABEL: Record<AgentOpType, string> = {
  exec: '命令执行',
  install: '安装 Runner',
  upgrade: '升级 Runner',
}

const OP_STATUS_LABEL: Record<AgentOpStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
}

export function agentOpTypeLabel(t: AgentOpType): string {
  return OP_TYPE_LABEL[t] ?? t
}

export function agentOpStatusLabel(s: AgentOpStatus): string {
  return OP_STATUS_LABEL[s] ?? s
}

export function isTerminalStatus(s: AgentOpStatus): boolean {
  return s === 'succeeded' || s === 'failed'
}

// 解析一段 SSE 事件块（以空行分隔），返回 { event, data }。注释行（: 开头）与
// ping（: ping）被忽略；缺 event 时默认 "message"。解析失败返回 null。
export function parseSSERawEvent(block: string): { event: string; data: string } | null {
  let event = 'message'
  let data = ''
  let hasField = false
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    if (line.startsWith(':')) continue // comment / ping
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const field = line.slice(0, idx)
    const value = line.slice(idx + 1).replace(/^ /, '')
    hasField = true
    if (field === 'event') event = value
    else if (field === 'data') data += (data ? '\n' : '') + value
  }
  if (!hasField) return null
  return { event, data }
}

// 把一个 SSE 事件解码为内部 OpEvent；未知 kind 返回 null（保持渲染幂等）。
export function decodeOpEvent(event: string, data: string): OpEvent | null {
  if (event === 'status') {
    try {
      return { kind: 'status', status: JSON.parse(data) as AgentOp }
    } catch {
      return null
    }
  }
  if (event === 'log') {
    try {
      return { kind: 'log', log: JSON.parse(data) as AgentOpLog }
    } catch {
      return null
    }
  }
  // 'end' 是终态信号，不进入事件流，由调用方单独处理。
  return null
}
