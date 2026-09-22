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
  // 按组织列服务（hub `GET /orgs/:id/services`，CONSOLE-UI-DESIGN.md 附 A N-9）。
  // 服务树页懒加载用它而不用 listByServiceTree：调用方手上只有**组织** id，
  // 走旧端点得先多打一次 /orgs/:id/service-tree 换树 id —— 懒加载恰好是
  // "每展开一次多一跳"的场景，省掉的正是这一跳。
  listByOrg: (orgId: string, p?: Pagination) => listPaged<Service>(`/orgs/${orgId}/services`, p),
}
