import { defineStore } from 'pinia'
import { authApi } from '@/api/auth'
import { userinfoApi, type UserInfo } from '@/api/userinfo'

// BFF 认证模型（AUTH-ARCHITECTURE.md）：浏览器不持 Keycloak token，只持 hub 的
// httpOnly session cookie。所有认证操作经 hub 的 /api/v1/auth/* 端点。登录页自有
// （/user/login，LoginView.vue），state.mode 在 login / updatePassword 间切换。

// 配置解析：window.__APP_CONFIG__（chart config.yaml 注入）> import.meta.env（dev）。
interface AppConfig {
  VITE_AUTH_DISABLED?: string
}
const runtimeCfg: AppConfig = (window as unknown as { __APP_CONFIG__?: AppConfig }).__APP_CONFIG__ ?? {}
const cfg = (key: keyof AppConfig): string | undefined => runtimeCfg[key] ?? import.meta.env[key]

// 开发旁路：VITE_AUTH_DISABLED=true 时跳过认证，直接进入已登录态（本地无 hub/KC）。
const AUTH_DISABLED = cfg('VITE_AUTH_DISABLED') === 'true'

export type LoginMode = 'login' | 'updatePassword'

// SessionUser 保留 oidc 风格的 profile 子对象，让既有组件（MainLayout 读
// auth.user?.profile?.sub 等）不改即兼容——profile 由 userinfo 字段映射填充。
export interface SessionUser extends UserInfo {
  profile: {
    sub: string
    preferred_username?: string
    name?: string
    email?: string
    groups?: string[]
  }
}

function toSessionUser(info: UserInfo): SessionUser {
  return {
    ...info,
    profile: {
      sub: info.subject,
      preferred_username: info.username,
      name: info.username,
      groups: info.groups,
    },
  }
}

const devUser: SessionUser = {
  subject: 'dev-user',
  username: 'dev-user',
  groups: [],
  orgs: [],
  roles: ['platform-admin'],
  orgAdmins: ['acme'],
  profile: { sub: 'dev-user', preferred_username: 'dev-user', name: 'dev-user' },
}

// AuthError carries the structured reason from a 400 (e.g. UPDATE_PASSWORD) so
// the LoginView can branch its UX without string-matching the message text.
export class AuthError extends Error {
  reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'AuthError'
    this.reason = reason
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as SessionUser | null,
    initialized: false,
    // LoginView mode state machine (URL /user/login stays fixed; mode switches).
    mode: 'login' as LoginMode,
    pendingUsername: '' as string,
    pendingReason: '' as string,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user,
    // accessToken 恒为 null：BFF 模式下浏览器不持 token，所有请求（含 SSE 流式
    // fetch）靠 httpOnly cookie 鉴权（axios withCredentials / fetch credentials:'include'）。
    accessToken: () => null as string | null,
    roles: (state) => state.user?.roles ?? [],
    orgs: (state) => state.user?.orgs ?? [],
    orgAdmins: (state) => state.user?.orgAdmins ?? [],
    authDisabled: () => AUTH_DISABLED,
  },

  actions: {
    /** 拉取 hub 权限镜像（角色 / 组织）。401 = 无会话，静默降级为未登录。 */
    async loadUserinfo() {
      try {
        this.user = toSessionUser(await userinfoApi.get())
      } catch {
        this.user = null
      }
    },

    /** App 启动 / 路由守卫首次调用时触发：用 cookie 探测会话是否有效。 */
    async init() {
      if (AUTH_DISABLED) {
        this.user = devUser
      } else {
        await this.loadUserinfo()
      }
      this.initialized = true
    },

    /**
     * Flow A 登录。200 = 会话已建（user 已装载）；400 reasons[0]=UPDATE_PASSWORD =
     * 强制改密（store 切 mode=updatePassword，抛 AuthError(UPDATE_PASSWORD) 让
     * LoginView 切表单）；401 = 凭据无效（抛 AuthError(INVALID_CREDENTIALS)）。
     */
    async login(username: string, password: string): Promise<void> {
      try {
        await authApi.login(username, password)
        await this.loadUserinfo()
      } catch (e) {
        const status = (e as { response?: { status?: number } }).response?.status
        if (status === 400) {
          const reasons = (e as { response?: { data?: { reasons?: string[] } } }).response?.data?.reasons
          const reason = reasons?.[0] ?? 'UNKNOWN'
          this.mode = 'updatePassword'
          this.pendingUsername = username
          this.pendingReason = reason
          throw new AuthError(reason)
        }
        if (status === 401) throw new AuthError('INVALID_CREDENTIALS')
        throw e
      }
    },

    /**
     * 强制改密提交。成功后切回 mode=login，清 pendingReason；LoginView 提示
     * 用户用新密码重新登录（不在此自动建会话，见 AUTH-ARCHITECTURE §3）。
     */
    async changePassword(oldPassword: string, newPassword: string): Promise<void> {
      await authApi.password(this.pendingUsername, oldPassword, newPassword)
      this.mode = 'login'
      this.pendingReason = ''
    },

    /** Flow B：取后端生成的 KC 登录 URL（含 PKCE），浏览器跳转。 */
    async getLoginUrl(): Promise<{ loginUrl: string; state: string }> {
      return authApi.loginUrl()
    },

    /** Flow B 回调：code 交换。200 = 会话已建。 */
    async handleOAuthCallback(code: string, state: string): Promise<void> {
      await authApi.sessionCode(code, state)
      await this.loadUserinfo()
    },

    async logout(): Promise<void> {
      try {
        await authApi.logout()
      } catch {
        // best-effort: cookie 可能已失效
      }
      this.user = null
      this.mode = 'login'
    },
  },
})
