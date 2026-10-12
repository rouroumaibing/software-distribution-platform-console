import { http } from './http'

export interface Notification {
  id: string
  type: 'approval'
  title: string
  body: string
  link: string
  createdAt: string
}

export interface NotificationList {
  data: Notification[]
  total: number
  unreadCount?: number
}

// 通知中心（STATUS §2 #7）：铃铛消费的运行中心通知流，当前来源 = 待审批运行。
// 服务端已读游标（RUNNER-REFLUX-SPEC §6）：list 带 unreadCount（服务端时钟），
// markRead 推进 hub 侧游标（只前进不回退）。旧 hub 无 read-mark 端点时
// markRead 请求 404/503，前端自动回退 localStorage 游标。
export const notificationApi = {
  list: () =>
    http
      .get<NotificationList & { data: Notification[] }>('/notifications')
      .then((r) => r.data),
  markRead: (readAt?: string) =>
    http.post('/notifications/read-mark', readAt ? { readAt } : {}).catch(() => undefined),
}

// ---- §5.2 通知订阅（决策 #5 收敛：本期渠道 = 邮箱） -----------------------

export type SubscriptionEvent = 'approval_required' | 'run_finished' | 'run_failed'

export interface Subscription {
  subject?: string
  email: string
  events: string // 逗号分隔白名单；'' = 默认 approval_required
  enabled: boolean
}

export const subscriptionApi = {
  get: () =>
    http.get<{ data: Subscription }>('/notifications/subscription').then((r) => r.data.data),
  update: (sub: Subscription) =>
    http.put<{ data: Subscription }>('/notifications/subscription', sub).then((r) => r.data.data),
}

export const SUBSCRIPTION_EVENTS: Array<{ key: SubscriptionEvent; label: string }> = [
  { key: 'approval_required', label: '待我审批（行动项）' },
  { key: 'run_finished', label: '运行成功（终态）' },
  { key: 'run_failed', label: '运行失败 / 取消' },
]
