import { http } from './http'
import { createCrud, listPaged } from './crud'
import type { Envelope, Pagination } from './http'

export interface User {
  id: string
  orgId: string
  email: string
  name: string
  createdAt: string
}

// V1 legacy roles table (Viewer/Editor/Admin) — retained for the migration
// window so legacy role-bindings can still be displayed. New grants use the
// §7 ComponentRole model below.
export interface Role {
  id: string
  orgId?: string
  name: string
  permissions: string[]
  isSystem: boolean
}

// §7 component-scoped role (component_roles). This is what the binding picker
// offers going forward.
export interface ComponentRole {
  id: string
  orgId?: string | null
  name: string
  description?: string
  actions: string[]
  isSystem: boolean
}

// §7 subject model (authoritative as of P3):
//   - subjectType : 'user' | 'group'
//   - subjectId   : user id (uuid) | Keycloak group name
//   - componentRoleId : the granted component_roles role
// V1 legacy fields (userId/roleId) may still appear on rows migrated from the
// old single-roles model; the UI falls back to them for display only.
export interface ComponentRoleBinding {
  id: string
  componentId: string
  orgId?: string | null
  subjectType?: 'user' | 'group'
  subjectId?: string
  componentRoleId?: string
  // V1 legacy (read-only, present on old rows)
  userId?: string
  roleId?: string
  grantedBy?: string
  grantedAt: string
}

// §7.2 平台级角色（C-10 `/platform-roles`）：内置 sdp-admin 等 + 组织自定义。
// 这是平台级授权的权威角色表，取代了 V1 单一 `roles` 表。
export interface PlatformRole {
  id: string
  orgId?: string | null
  name: string
  description?: string
  actions: string[]
  isSystem: boolean
  createdAt: string
}

// 平台级绑定（C-10 `/platform-role-bindings`）：把主体（user / Keycloak 组）
// 关联到某个 PlatformRole。expiresAt 为 null = 永久；非空且已过期则在
// ListMatching 中被过滤（见 ACCOUNT-PERMISSION-MODEL §7.4 / §10 #15）。
export interface PlatformRoleBinding {
  id: string
  orgId?: string | null
  subjectType: 'user' | 'group'
  subjectId: string
  platformRoleId: string
  expiresAt?: string | null
  createdAt: string
}

const userCrud = createCrud<User>('/users')

export const permissionApi = {
  users: {
    ...userCrud,
    list: (p?: Pagination) => listPaged<User>('/users', p),
  },

  // V1 角色是种子数据(Viewer/Editor/Admin),只读,没有增删改接口。
  roles: {
    list: () => http.get<{ data: Role[] }>('/roles').then((r) => r.data.data),
  },

  // §7 组件角色(component_roles):内置 viewer/editor/approver/admin + 组织自定义。
  // 绑定选择器使用这一组而不是 V1 roles。
  componentRoles: {
    list: () => http.get<{ data: ComponentRole[] }>('/component-roles').then((r) => r.data.data),
  },

  bindings: {
    // §7 写路径:subjectType + subjectId + componentRoleId。
    create: (
      componentId: string,
      payload: { subjectType: 'user' | 'group'; subjectId: string; componentRoleId: string },
    ) =>
      http
        .post<{ data: ComponentRoleBinding }>(`/components/${componentId}/role-bindings`, payload)
        .then((r) => r.data.data),
    listByComponent: (componentId: string) =>
      http
        .get<{ data: ComponentRoleBinding[] }>(`/components/${componentId}/role-bindings`)
        .then((r) => r.data.data),
    remove: (id: string) => http.delete(`/role-bindings/${id}`),
  },

  // §7.2 平台级 RBAC（C-10）。createCrud 覆盖标准的 create/get/update/remove；
  // list 单独写（handler 直接返回数组，无分页信封）。
  platformRoles: {
    ...createCrud<PlatformRole>('/platform-roles'),
    list: () =>
      http.get<Envelope<PlatformRole[]>>('/platform-roles').then((r) => r.data.data ?? []),
  },

  // 平台级绑定：只有 GET/POST/DELETE（改角色 = 删后重建，handler 无 Update）。
  platformBindings: {
    list: () =>
      http
        .get<Envelope<PlatformRoleBinding[]>>('/platform-role-bindings')
        .then((r) => r.data.data ?? []),
    create: (
      payload: {
        subjectType: 'user' | 'group'
        subjectId: string
        platformRoleId: string
        expiresAt?: string | null
      },
    ) =>
      http
        .post<Envelope<PlatformRoleBinding>>('/platform-role-bindings', payload)
        .then((r) => r.data.data as PlatformRoleBinding),
    remove: (id: string) => http.delete(`/platform-role-bindings/${id}`),
  },
}
