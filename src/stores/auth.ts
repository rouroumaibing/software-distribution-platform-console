import { defineStore } from 'pinia'
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import { userinfoApi, type UserInfo } from '@/api/userinfo'

// 配置解析优先级：window.__APP_CONFIG__（容器运行时由 console chart 的
// templates/config.yaml 渲染 /usr/share/nginx/html/config.js 注入）> import.meta.env（构建期注入，dev 用）。
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
    userinfo: null as UserInfo | null,
    initialized: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user && !state.user.expired,
    accessToken: (state) => state.user?.access_token ?? null,
    // 授权相关展示的唯一真相源（hub /api/userinfo）；token 的 realm_access 不读。
    roles: (state) => state.userinfo?.roles ?? [],
    orgs: (state) => state.userinfo?.orgs ?? [],
    keycloakIssuer: () => cfg('VITE_KEYCLOAK_ISSUER_URL') ?? '',
    // 开发旁路旗标（router 守卫旁路判断用）。
    authDisabled: () => AUTH_DISABLED,
  },

  actions: {
    /** 拉取 hub 权限镜像（角色 / 组织）。失败静默降级，不阻断登录态。 */
    async loadUserinfo() {
      try {
        this.userinfo = await userinfoApi.get()
      } catch {
        this.userinfo = null
      }
    },

    /** App 启动时调用一次,尝试从本地存储恢复已登录状态。 */
    async init() {
      if (AUTH_DISABLED) {
        this.user = devUser
      } else {
        this.user = (await userManager?.getUser()) ?? null
      }
      this.initialized = true
      // 登录态恢复后异步补齐权限镜像；token 缺失（dev / 未登录）时自然降级。
      if (this.accessToken) {
        void this.loadUserinfo()
      }
    },

    /** 跳转到 Keycloak 登录页。target 为登录成功后要回跳的路由，经 Keycloak state 承载。 */
    async login(target = '/') {
      if (AUTH_DISABLED) {
        this.user = devUser
        return
      }
      await userManager?.signinRedirect({ state: target })
    },

    /**
     * /auth/callback 路由里调用,处理 Keycloak 跳回来时带的 code。
     * 返回 true = 本次登录刚完成密码设置/修改（§7.15 首登强制改密），
     * 调用方须立即 logout 回登录页；false = 正常入站。
     */
    async handleCallback(): Promise<boolean> {
      if (AUTH_DISABLED) {
        this.user = devUser
        return false
      }
      this.user = (await userManager?.signinRedirectCallback()) ?? null
      if (this.accessToken) {
        void this.loadUserinfo()
      }
      return passwordJustChanged(this.user)
    },

    /**
     * 登出并回到 console 首页。post_logout_redirect_uri 命中 client 的
     * redirectUris 通配（https://host/*）；落到首页后未认证守卫会直接送进
     * Keycloak 登录页（§7.15.1 登录直达），完成「登出 → 回登录页」闭环。
     */
    async logout() {
      if (AUTH_DISABLED) return
      await userManager?.signoutRedirect({
        post_logout_redirect_uri: `${window.location.origin}/`,
        id_token_hint: this.user?.id_token,
      })
      this.user = null
    },
  },
})

/** 密码凭证 createdDate 与本轮认证起点 auth_time 的比对容差（毫秒）。 */
const PASSWORD_CHANGE_TOLERANCE_MS = 5000

interface AccountCredentialEntry {
  type?: string
  userCredentialMetadatas?: Array<{ credential?: { createdDate?: number } }>
}

/**
 * 检测本次登录是否刚完成密码设置/修改（UPDATE_PASSWORD required action）。
 *
 * Keycloak 对持久 requiredAction（如 bootstrap admin 种子的 UPDATE_PASSWORD）
 * 完成后回跳 callback 时**不带** kc_action_status（那是 AIA 专有参数），token 内
 * 亦无 requiredActions 类 claim——确定性信号是：密码凭证的 createdDate 落在本轮
 * 认证起点（token auth_time）之后（±容差），即密码是本次登录过程中设置的。
 * 数据用用户自身 access_token 调 Keycloak Account API 读取，无需 admin 权限。
 *
 * Account API 不可达 / 解析失败一律降级放行（返回 false）：Keycloak 已强制完成
 * 改密，检测失败只是退化为 Keycloak 原生行为（直接进 console），不阻断登录。
 */
async function passwordJustChanged(user: User | null): Promise<boolean> {
  if (!user?.access_token) return false
  const authTime = (user.profile as { auth_time?: number } | undefined)?.auth_time
  const issuer = cfg('VITE_KEYCLOAK_ISSUER_URL')
  if (!authTime || !issuer) return false
  try {
    const res = await fetch(
      `${issuer.replace(/\/$/, '')}/account/credentials?credentialType=password`,
      { headers: { Authorization: `Bearer ${user.access_token}` } },
    )
    if (!res.ok) return false
    const list = (await res.json()) as AccountCredentialEntry[]
    const entry = list.find((c) => c.type === 'password') ?? list[0]
    const created = entry?.userCredentialMetadatas?.[0]?.credential?.createdDate
    if (typeof created !== 'number') return false
    return created >= authTime * 1000 - PASSWORD_CHANGE_TOLERANCE_MS
  } catch {
    return false
  }
}
