import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

export interface Target {
  id: string
  name: string
  vendor: string
  region: string
  status: 'online' | 'offline'
  agentVersion?: string
  lastHeartbeatAt?: string
  createdAt: string
}

const crud = createCrud<Target>('/targets')

export const targetApi = {
  ...crud,
  list: (p?: Pagination) => listPaged<Target>('/targets', p),
}
