import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

// "服务"这个业务实体的前端模块沿用了跟 hub 一样的 catalog 命名,避免跟
// 泛指"后端接口调用层"的 api/ 目录本身产生混淆。
export interface Service {
  id: string
  serviceTreeId: string
  key: string
  name: string
  description?: string
  ownerTeam?: string
  createdAt: string
  updatedAt: string
}

const crud = createCrud<Service>('/services')

export const catalogApi = {
  ...crud,
  listByServiceTree: (treeId: string, p?: Pagination) =>
    listPaged<Service>(`/service-trees/${treeId}/services`, p),
}
