import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 路由表（IA v4.4，CONSOLE-UI-DESIGN.md）：左侧菜单恒 5 项
// （总览/服务树/运行中心 + 平台管理 2 项）；
// 组件详情 = /components/:id 全屏子路由 Tab（概览/配置/流水线/运行/发布/制品/环境/权限/日志）；
// 运行中心的 运行/发布 是同一页的两个视图，用 ?view= 承载而不是子路由（附 B N-13；
// IA v4.4 无「流水线」顶层视图，其列表归属「组件详情 · 交付 · 流水线」）。
// 旧 flat 菜单路由（/pipelines /releases /artifacts /environments /permissions /logs）→ redirect。
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      // 自有登录页（AUTH-ARCHITECTURE §9）：state.mode 在 login/updatePassword 间切换
      path: '/user/login',
      name: 'user-login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/auth/callback',
      name: 'auth-callback',
      component: () => import('@/views/AuthCallback.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layout/MainLayout.vue'),
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '总览' } },
        { path: 'service-tree', component: () => import('@/views/ServiceTreeView.vue'), meta: { title: '服务树' } },
        // §5.2 通知订阅设置（铃铛面板入口；个人级，不进左栏）
        { path: 'notifications/settings', component: () => import('@/views/NotificationSettingsView.vue'), meta: { title: '通知订阅' } },
        // §6.4 访问令牌（个人中心入口；个人级）
        { path: 'me/tokens', component: () => import('@/views/PersonalTokensView.vue'), meta: { title: '访问令牌' } },

        // ---- 组件详情（全屏 Tab 化）----
        {
          path: 'components/:id',
          component: () => import('@/views/ComponentDetailView.vue'),
          meta: { title: '组件详情' },
          children: [
            { path: '', redirect: (to) => ({ path: `/components/${to.params.id}/overview` }) },
            { path: 'overview', name: 'component-overview', component: () => import('@/views/component/tabs/OverviewTab.vue'), meta: { title: '组件概览' } },
            { path: 'config', name: 'component-config', component: () => import('@/views/component/tabs/ConfigTab.vue'), meta: { title: '组件配置' } },
            { path: 'pipelines', name: 'component-pipelines', component: () => import('@/views/component/tabs/PipelinesTab.vue'), meta: { title: '组件流水线' } },
            { path: 'runs', name: 'component-runs', component: () => import('@/views/component/tabs/RunsTab.vue'), meta: { title: '组件运行' } },
            { path: 'releases', name: 'component-releases', component: () => import('@/views/component/tabs/ReleasesTab.vue'), meta: { title: '组件发布' } },
            { path: 'artifacts', name: 'component-artifacts', component: () => import('@/views/component/tabs/ArtifactsTab.vue'), meta: { title: '组件制品' } },
            { path: 'environments', name: 'component-environments', component: () => import('@/views/component/tabs/EnvironmentsTab.vue'), meta: { title: '组件环境' } },
            { path: 'permissions', name: 'component-permissions', component: () => import('@/views/component/tabs/PermissionsTab.vue'), meta: { title: '组件权限' } },
            { path: 'audit', name: 'component-audit', component: () => import('@/views/component/tabs/AuditTab.vue'), meta: { title: '组件审计' } },
            { path: 'logs', name: 'component-logs', component: () => import('@/views/component/tabs/LogsTab.vue'), meta: { title: '组件日志' } },
            { path: 'vars', name: 'component-vars', component: () => import('@/views/component/tabs/VarsTab.vue'), meta: { title: '组件变量与密钥' } },
          ],
        },

        // ---- 运行中心（唯一全局巡视入口，含 运行/发布 两视图）----
        // 两视图共用一个路由，切面靠 ?view= 承载（CONSOLE-UI-DESIGN.md 附 B N-13）。
        { path: 'runs', component: () => import('@/views/RunCenterView.vue'), meta: { title: '运行中心' } },

        // ---- 组织工作台（ACCESS-CONTROL §6，L2 守卫）----
        // /org/dashboard?org=<slug>：当前用户须为 <slug> 的 org_admin（userinfo.orgAdmins
        // 含该组织名），否则 beforeEach 重定向 /forbidden。无 org 参数时要求至少是一个
        // 组织的管理员（由页面引导选择具体组织）。
        { path: 'org/dashboard', component: () => import('@/views/OrgDashboardView.vue'), meta: { title: '组织工作台' } },

        // ---- 下钻路由（保持不变）----
        { path: 'pipelines/:id', component: () => import('@/views/PipelineEditorView.vue'), meta: { title: '流水线编排' } },
        { path: 'pipelines/:id/runs', component: () => import('@/views/RunListView.vue'), meta: { title: '运行历史' } },
        { path: 'pipelines/:pipelineId/runs/:runId', component: () => import('@/views/RunMonitorView.vue'), meta: { title: '运行监控' } },
        { path: 'releases/:id', component: () => import('@/views/ReleaseDetailView.vue'), meta: { title: '灰度发布' } },

        // ---- 平台管理 ----
        // /admin/dashboard：平台管理面入口（ACCESS-CONTROL §6），L1 守卫
        // （roles 含 platform-admin）在 beforeEach 统一施加，失败 → /forbidden。
        { path: 'admin/dashboard', component: () => import('@/views/AdminDashboardView.vue'), meta: { title: '平台管理台' } },
        { path: 'admin/permissions', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'permissions' }, meta: { title: '用户与平台权限' } },
        { path: 'admin/targets', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'targets' }, meta: { title: '接入管理' } },
        { path: 'admin/credentials', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'credentials' }, meta: { title: '凭据管理' } },
        { path: 'admin/audit', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'audit' }, meta: { title: '平台审计日志' } },
        { path: 'admin/settings', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'settings' }, meta: { title: '平台设置' } },
        { path: 'admin/upgrade-approvals', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'upgrade-approvals' }, meta: { title: '升级审批' } },
        // AUTH-ARCHITECTURE §5 — 认证设置（登录模式 + 身份提供商），L1 守卫。
        { path: 'admin/auth', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'auth' }, meta: { title: '认证设置' } },
        // ACCESS-CONTROL §7 — K8s RBAC 授权层管理页（集群权限），L1 守卫。
        { path: 'admin/cluster-permissions', component: () => import('@/views/ClusterPermissionsView.vue'), meta: { title: '集群权限' } },

        // ---- 全局错误态（STATUS #21）----
        // 403：http 响应拦截器（api/http.ts）统一跳转；也可直达 /forbidden。
        { path: 'forbidden', component: () => import('@/views/ErrorView.vue'), props: { kind: 'forbidden' }, meta: { title: '没有访问权限' } },
        // 404：catch-all 必须放 children 最后；/forbidden 自身不进 catch-all。
        { path: ':pathMatch(.*)*', component: () => import('@/views/ErrorView.vue'), props: { kind: 'not-found' }, meta: { title: '页面不存在' } },
        { path: 'admin/targets/:targetId/agent-ops', component: () => import('@/views/AgentOpsView.vue'), props: true, meta: { title: '操作台账' } },
        { path: 'admin/clusters', redirect: '/admin/targets' },

        // ---- 旧 flat 菜单路由 → redirect（deep link 兼容）----
        // 「发布」是运行中心的视图（IA v4 无顶层「发布」页）—— 旧链要直接落到该视图，
        // 而不是笼统地回 /runs（否则点「发布」旧链看到运行列表，属静默语义漂移；
        // 附 B 硬约束 ⑤）。
        // 「流水线」则连视图都不是（v4.4 起），它的列表归「组件详情 · 交付 · 流水线」，
        // 旧链只能落到资源浏览页 /service-tree —— 落到任何"列表"都是另一种语义漂移
        // （附 B B.6 硬约束 ⑤ 的 v4.4 追加）。
        { path: 'components', redirect: '/service-tree' },
        { path: 'pipelines', redirect: '/service-tree' },
        { path: 'releases', redirect: { path: '/runs', query: { view: 'releases' } } },
        { path: 'artifacts', redirect: '/service-tree' },
        { path: 'environments', redirect: '/admin/targets' },
        { path: 'permissions', redirect: '/admin/permissions' },
        { path: 'logs', redirect: '/service-tree' },
      ],
    },
  ],
})

// 未认证访问受保护路由 → 重定向到自有登录页 /user/login（AUTH-ARCHITECTURE §9 /
// ui-05 §7.15.1）。登录入口与 Keycloak 之间无中间说明页；目标路由经 query.redirect
// 承载，登录成功后回跳。Flow B 的 SSO 入口由 LoginView 调 GET /api/auth/login-url。
//
// 角色守卫（ACCESS-CONTROL §6）：认证通过后再施加 L1/L2 双层角色校验，失败不回登录
// （已认证只是无权），直接落到 /forbidden。认证旁路（VITE_AUTH_DISABLED）跳过守卫。
//   - L1 平台管理面：/admin/* 要求 userinfo.roles 含 platform-admin
//   - L2 组织工作台：/org/dashboard 要求 userinfo.orgAdmins 含当前组织（?org=）；
//     无 org 参数时要求至少是一个组织的管理员
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) await auth.init()

  if (to.meta.public || auth.isAuthenticated || auth.authDisabled) {
    if (!to.meta.public && !auth.authDisabled) {
      if (to.path.startsWith('/admin/') && !auth.roles.includes('platform-admin')) {
        return { path: '/forbidden' }
      }
      if (to.path.startsWith('/org/dashboard')) {
        const org = (to.query.org as string) || ''
        if (org ? !auth.orgAdmins.includes(org) : auth.orgAdmins.length === 0) {
          return { path: '/forbidden' }
        }
      }
    }
    return true
  }
  return { path: '/user/login', query: { redirect: to.fullPath } }
})

export default router
