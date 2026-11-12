import { http, type Envelope } from './http'

// hub 的权限权威镜像（ACCOUNT-PERMISSION-MODEL §8 #3 / §10 #13）：
// 前端授权相关展示（角色 / 组织）的唯一真相源，禁止读 token 的 realm_access。
// 端点 GET /api/v1/userinfo（handler 注册于 /api/v1 组），鉴权后返回当前主体
// 的身份 + 平台角色 + 组织归属。身份四字段（name/username/email/sub）仍由
// 授权展示数据由本 userinfo 端点聚合返回（角色/绑定等），遵循 OIDC 标准 profile 字段，不再依赖 oidc-client-ts。
export interface UserInfo {
  subject: string
  username?: string
  groups: string[]
  orgs: string[]
  roles: string[]
  // L2 组织管理员组织名集合（ACCESS-CONTROL §1.2 / §6）：决定 /org/dashboard 可见性。
  // 由 hub 从 Keycloak `org_admin` attribute 映射，前端只消费、不解析 token。
  orgAdmins: string[]
}

export const userinfoApi = {
  get: () => http.get<Envelope<UserInfo>>('/userinfo').then((r) => r.data.data as UserInfo),
}
