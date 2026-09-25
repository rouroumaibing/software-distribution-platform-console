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
}

// 通知中心（STATUS §2 #7）：铃铛消费的运行中心通知流，当前来源 = 待审批运行。
export const notificationApi = {
  list: () =>
    http.get<{ data: Notification[]; total: number }>('/notifications').then((r) => r.data.data),
}
