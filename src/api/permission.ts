import { http } from './http'
import { createCrud, listPaged } from './crud'
import type { Pagination } from './http'

export interface User {
  id: string
  orgId: string
  email: string
  name: string
  createdAt: string
}

export interface Role {
  id: string
  orgId?: string
  name: string
  permissions: string[]
  isSystem: boolean
}

export interface ComponentRoleBinding {
  id: string
  componentId: string
  userId: string
  roleId: string
  grantedAt: string
}

const userCrud = createCrud<User>('/users')

export const permissionApi = {
  users: {
    ...userCrud,
    list: (p?: Pagination) => listPaged<User>('/users', p),
  },

  // 角色是种子数据(Viewer/Editor/Admin),只读,没有增删改接口。
  roles: {
    list: () => http.get<{ data: Role[] }>('/roles').then((r) => r.data.data),
  },

  bindings: {
    create: (componentId: string, payload: { userId: string; roleId: string }) =>
      http
        .post<{ data: ComponentRoleBinding }>(`/components/${componentId}/role-bindings`, payload)
        .then((r) => r.data.data),
    listByComponent: (componentId: string) =>
      http
        .get<{ data: ComponentRoleBinding[] }>(`/components/${componentId}/role-bindings`)
        .then((r) => r.data.data),
    remove: (id: string) => http.delete(`/role-bindings/${id}`),
  },
}
