import { http, type Envelope } from './http'

// BFF 认证端点（AUTH-ARCHITECTURE.md §7）。baseURL 已是 /api/v1，故路径用 /auth/*。
// 浏览器不持 KC token；所有认证操作经 hub 的 /api/v1/auth/*，凭据靠 httpOnly
// session cookie（http.ts 的 withCredentials）。

// 协议层登录模式（AUTH-ARCHITECTURE §2）：default=自研密码表单（Flow A，无 SSO）；
// keycloak=OIDC code 流（Flow B，带 SSO）。两者互斥，由平台管理员切换并持久化到 hub DB。
export type ProtocolLoginMode = 'default' | 'keycloak'

export interface LoginURLResult {
  loginUrl: string
  state: string
}

// 未登录态即可读：登录页据 login 模式决定渲染（自研表单 vs 自动跳 KC）。
export interface AuthConfig {
  login: ProtocolLoginMode
}

// 身份提供商（realmsettings/identityprovider CRUD，AUTH-ARCHITECTURE §5）：
// hub 透传 Keycloak IdentityProviderRepresentation，不重解释，支持 oidc/saml/cas 等。
export interface IdentityProvider {
  alias: string
  displayName?: string
  providerId: string
  enabled: boolean
  trustEmail?: boolean
  config?: Record<string, string>
}

export const authApi = {
  // 未登录态可读：登录页据 login 模式决定渲染（自研表单 vs 自动跳 KC）。
  authConfig: () =>
    http.get<Envelope<AuthConfig>>('/auth/config').then((r) => r.data.data as AuthConfig),

  // Flow B 入口：后端生成 KC auth URL + 持 PKCE verifier
  loginUrl: () =>
    http.get<Envelope<LoginURLResult>>('/auth/login-url').then((r) => r.data.data as LoginURLResult),

  // Flow A 入口：password grant。200 = 会话已建；400 reasons[0]=UPDATE_PASSWORD = 强制改密；401 = 凭据无效
  login: (username: string, password: string) =>
    http.post<Envelope<{ authenticated: boolean }>>('/auth/login', { username, password }),

  // Flow B 回调：code 交换。200 = 会话已建
  sessionCode: (code: string, state: string) =>
    http.post<Envelope<{ authenticated: boolean }>>('/auth/session/code', { code, state }),

  // 强制改密：旧密码验证放行 not-fully-set-up + temporary=false + 清 RA + logout-all
  password: (username: string, oldPassword: string, newPassword: string) =>
    http.post<Envelope<{ changed: boolean; subject: string }>>('/auth/password', { username, oldPassword, newPassword }),

  logout: () => http.post('/auth/logout'),

  // ---- 平台管理：认证设置（realmsettings，需 platform-admin / user:manage）----
  // 切换协议层登录模式。切回 default 时若仍有 enabled 的 IDP → 409 拒绝。
  setLoginMode: (login: ProtocolLoginMode) =>
    http.put<Envelope<{ login: ProtocolLoginMode }>>('/login', { login }).then((r) => r.data.data as { login: ProtocolLoginMode }),

  // 身份提供商目录
  listIDP: () =>
    http.get<Envelope<{ identityProviders: IdentityProvider[] }>>('/identityprovider').then((r) => r.data.data as { identityProviders: IdentityProvider[] }),
  getIDP: (alias: string) =>
    http.get<Envelope<IdentityProvider>>(`/identityprovider/${encodeURIComponent(alias)}`).then((r) => r.data.data as IdentityProvider),
  createIDP: (idp: IdentityProvider) =>
    http.post<Envelope<{ alias: string }>>('/identityprovider', idp).then((r) => r.data.data as { alias: string }),
  updateIDP: (alias: string, idp: IdentityProvider) =>
    http.put<Envelope<{ alias: string }>>(`/identityprovider/${encodeURIComponent(alias)}`, idp).then((r) => r.data.data as { alias: string }),
  deleteIDP: (alias: string) =>
    http.delete(`/identityprovider/${encodeURIComponent(alias)}`),
  // KC 支持的 provider 工厂 id 白名单（oidc / saml / cas / ...），供前端下拉校验。
  listIDPTypes: () =>
    http.get<Envelope<{ types: string[] }>>('/identityprovider/types').then((r) => r.data.data as { types: string[] }),
}
