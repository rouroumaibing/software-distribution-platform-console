import { http } from './http'
import { createCrud } from './crud'
import type { Envelope } from './http'

// 注意：这里**没有 User 类型，也没有 /users 端点**。
// hub 不存用户表（ACCOUNT-PERMISSION-MODEL §2.2 / D3），所以控制台拿不到
// 「系统里有哪些人」这份目录。授权表单改为「下拉已绑定主体 + 手输 sub」，
// 见 utils/permission.ts 的 knownSubjects / validateSubjectInput。

// V1 legacy roles table (Viewer/Editor/Admin) — 只读保留。
// D3 之后 `component_role_bindings.role_id` 已删，所以这些角色**不再可被绑定**；
// 保留列表只为历史行展示与 /roles 端点兼容。新的授权一律走下面的 ComponentRole。
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

// §7 subject model:
//   - subjectType : 'user' | 'group'
//   - subjectId   : Keycloak `sub`（user）| 组路径（group，带前导斜杠，§5.3）
//   - componentRoleId : the granted component_roles role
//
// D3 删掉了 V1 的 userId / roleId 两列，所以这里不再有「旧数据回退字段」——
// 每一行都必然是 §7 主体绑定。
export interface ComponentRoleBinding {
  id: string
  componentId: string
  orgId?: string | null
  subjectType?: 'user' | 'group'
  subjectId?: string
  componentRoleId?: string
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

// 平台级绑定（C-10 `/platform-role-bindings`）：把主体（user `sub` / Keycloak 组）
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

export const permissionApi = {
  // V1 角色是种子数据(Viewer/Editor/Admin),只读,没有增删改接口。
  // ⚠️ 不可用于新建绑定（role_id 列已随 D3 删除）。
  roles: {
    list: () => http.get<{ data: Role[] }>('/roles').then((r) => r.data.data),
  },

  // §7 组件角色(component_roles):内置 viewer/editor/approver/admin + 组织自定义。
  // 绑定选择器使用这一组；写端点（create/update/remove）需要平台级 user:manage，
  // 故挂在「平台管理 → 用户与平台权限」里管理（与平台角色同级）。
  componentRoles: {
    list: () => http.get<{ data: ComponentRole[] }>('/component-roles').then((r) => r.data.data),
    ...createCrud<ComponentRole>('/component-roles'),
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
