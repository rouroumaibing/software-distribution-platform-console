import { defineStore } from 'pinia'
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

// 配置解析优先级：window.__APP_CONFIG__（容器运行时由 envsubst 生成，见
// build/console/images/config.js.template）> import.meta.env（构建期注入，dev 用）。
interface AppConfig {
  VITE_AUTH_DISABLED?: string
  VITE_KEYCLOAK_ISSUER_URL?: string
  VITE_KEYCLOAK_CLIENT_ID?: string
  VITE_KEYCLOAK_REDIRECT_URI?: string
}
const runtimeCfg: AppConfig = (window as unknown as { __APP_CONFIG__?: AppConfig }).__APP_CONFIG__ ?? {}
const cfg = (key: keyof AppConfig): string | undefined => runtimeCfg[key] ?? import.meta.env[key]

// 开发旁路:VITE_AUTH_DISABLED=true 时跳过 Keycloak,直接进入已登录态。
// 仅用于本地无 Keycloak 的 UI 开发;hub 若开了鉴权,API 仍会 401(符合预期)。
const AUTH_DISABLED = cfg('VITE_AUTH_DISABLED') === 'true'

// 单个 UserManager 实例,跟后端 hub 用的是同一个 Keycloak Realm + Client
// (VITE_KEYCLOAK_CLIENT_ID 要跟 hub 的 KEYCLOAK_CLIENT_ID 保持一致,因为 hub
// 的 Authenticator 会校验 token 的 azp 是不是这个 client)。
const userManager = AUTH_DISABLED
  ? null
  : new UserManager({
      authority: cfg('VITE_KEYCLOAK_ISSUER_URL') ?? '',
      client_id: cfg('VITE_KEYCLOAK_CLIENT_ID') ?? '',
      redirect_uri: cfg('VITE_KEYCLOAK_REDIRECT_URI') ?? '',
      response_type: 'code', // Authorization Code + PKCE,oidc-client-ts 默认开 PKCE
      scope: 'openid profile email',
      userStore: new WebStorageStateStore({ store: window.localStorage }),
      automaticSilentRenew: true,
    })

// 旁路模式下伪造一个最小 User 结构(只够 isAuthenticated/profile 使用)。
const devUser = {
  expired: false,
  access_token: '',
  profile: { name: 'dev-user', preferred_username: 'dev-user' },
} as unknown as User

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    initialized: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user && !state.user.expired,
    accessToken: (state) => state.user?.access_token ?? null,
  },

  actions: {
    /** App 启动时调用一次,尝试从本地存储恢复已登录状态。 */
    async init() {
      if (AUTH_DISABLED) {
        this.user = devUser
      } else {
        this.user = (await userManager?.getUser()) ?? null
      }
      this.initialized = true
    },

    /** 跳转到 Keycloak 登录页。 */
    async login() {
      if (AUTH_DISABLED) {
        this.user = devUser
        return
      }
      await userManager?.signinRedirect()
    },

    /** /auth/callback 路由里调用,处理 Keycloak 跳回来时带的 code。 */
    async handleCallback() {
      if (AUTH_DISABLED) {
        this.user = devUser
        return
      }
      this.user = (await userManager?.signinRedirectCallback()) ?? null
    },

    async logout() {
      if (AUTH_DISABLED) return
      await userManager?.signoutRedirect()
      this.user = null
    },
  },
})
