import { http, type Envelope } from './http'

// BFF 认证端点（AUTH-ARCHITECTURE.md §7）。baseURL 已是 /api/v1，故路径用 /auth/*。
// 浏览器不持 KC token；所有认证操作经 hub 的 /api/v1/auth/*，凭据靠 httpOnly
// session cookie（http.ts 的 withCredentials）。
export interface LoginURLResult {
  loginUrl: string
  state: string
}

export const authApi = {
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
}
