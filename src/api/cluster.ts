import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

export interface Cluster {
  id: string
  name: string
  vendor: string
  region: string
  status: 'online' | 'offline'
  agentVersion?: string
  lastHeartbeatAt?: string
  createdAt: string
}

const crud = createCrud<Cluster>('/clusters')

export const clusterApi = {
  ...crud,
  list: (p?: Pagination) => listPaged<Cluster>('/clusters', p),
}
