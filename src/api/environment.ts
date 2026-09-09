import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

export interface Environment {
  id: string
  componentId: string
  key: string
  name: string
  clusterId: string
  envType: 'test' | 'production'
  namespace: string
  createdAt: string
}

const crud = createCrud<Environment>('/environments')

export const environmentApi = {
  ...crud,
  listByComponent: (componentId: string, p?: Pagination) =>
    listPaged<Environment>(`/components/${componentId}/environments`, p),
}
