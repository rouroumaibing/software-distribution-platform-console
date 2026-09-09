import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

export interface Org {
  id: string
  name: string
  slug: string
  createdAt: string
  updatedAt: string
}

export interface ServiceTree {
  id: string
  orgId: string
  name: string
  createdAt: string
}

const crud = createCrud<Org>('/orgs')

export const orgApi = {
  ...crud,
  list: (p?: Pagination) => listPaged<Org>('/orgs', p),
  getServiceTree: (orgId: string) =>
    import('./http').then(({ http }) =>
      http.get<{ data: ServiceTree }>(`/orgs/${orgId}/service-tree`).then((r) => r.data.data),
    ),
}
