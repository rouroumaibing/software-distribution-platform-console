import { http, type Envelope } from './http'

// hub 的权限权威镜像（ACCOUNT-PERMISSION-MODEL §8 #3 / §10 #13）：
// 前端授权相关展示（角色 / 组织）的唯一真相源，禁止读 token 的 realm_access。
// 端点 GET /api/v1/userinfo（handler 注册于 /api/v1 组），鉴权后返回当前主体
// 的身份 + 平台角色 + 组织归属。身份四字段（name/username/email/sub）仍由
// oidc-client-ts 的 profile 提供，本端点仅补充/对齐授权展示数据。
export interface UserInfo {
  subject: string
  username?: string
  groups: string[]
  orgs: string[]
  roles: string[]
}

export const userinfoApi = {
  get: () => http.get<Envelope<UserInfo>>('/userinfo').then((r) => r.data.data as UserInfo),
}
