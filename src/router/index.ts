import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 路由表（IA v4.4，CONSOLE-UI-DESIGN.md）：左侧菜单恒 5 项
// （总览/服务树/运行中心 + 平台管理 2 项）；
// 组件详情 = /components/:id 全屏子路由 Tab（概览/配置/流水线/运行/发布/制品/环境/权限/日志）；
// 运行中心的 运行/发布 是同一页的两个视图，用 ?view= 承载而不是子路由（附 B N-13；
// 「流水线」视图已于 v4.4 移除，其列表归属「组件详情 · 交付 · 流水线」）。
// 旧 flat 菜单路由（/pipelines /releases /artifacts /environments /permissions /logs）→ redirect。
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/auth/callback',
      name: 'auth-callback',
      component: () => import('@/views/AuthCallback.vue'),
      meta: { public: true },
    },
    {
      // 登录说明页：展示预置账号（临时密码批注 + 登录后重置提示），再由用户
      // 点击「继续登录」跳 Keycloak。meta.public = 未登录也可直达。
      path: '/login-hint',
      name: 'login-hint',
      component: () => import('@/views/LoginHintView.vue'),
      meta: { public: true, title: '登录说明' },
    },
    {
      path: '/',
      component: () => import('@/layout/MainLayout.vue'),
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '总览' } },
        { path: 'service-tree', component: () => import('@/views/ServiceTreeView.vue'), meta: { title: '服务树' } },

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
            { path: 'logs', name: 'component-logs', component: () => import('@/views/component/tabs/LogsTab.vue'), meta: { title: '组件日志' } },
          ],
        },

        // ---- 运行中心（唯一全局巡视入口，含 运行/发布 两视图）----
        // 两视图共用一个路由，切面靠 ?view= 承载（CONSOLE-UI-DESIGN.md 附 B N-13）。
        { path: 'runs', component: () => import('@/views/RunCenterView.vue'), meta: { title: '运行中心' } },

        // ---- 下钻路由（保持不变）----
        { path: 'pipelines/:id', component: () => import('@/views/PipelineEditorView.vue'), meta: { title: '流水线编排' } },
        { path: 'pipelines/:id/runs', component: () => import('@/views/RunListView.vue'), meta: { title: '运行历史' } },
        { path: 'pipelines/:pipelineId/runs/:runId', component: () => import('@/views/RunMonitorView.vue'), meta: { title: '运行监控' } },
        { path: 'releases/:id', component: () => import('@/views/ReleaseDetailView.vue'), meta: { title: '灰度发布' } },

        // ---- 平台管理 ----
        { path: 'admin/permissions', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'permissions' }, meta: { title: '用户与平台权限' } },
        { path: 'admin/targets', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'targets' }, meta: { title: '接入管理' } },
        { path: 'admin/clusters', redirect: '/admin/targets' },

        // ---- 旧 flat 菜单路由 → redirect（deep link 兼容）----
        // 「发布」v4 起不再是顶层页，降为运行中心的视图 —— 所以旧链要直接落到该视图，
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

// 除了标了 meta.public 的路由(登录说明页 / OIDC 回调页),其余一律要求已登录。
// 未登录先落到 /login-hint(预置账号 + 临时密码说明),由用户点击「继续登录」
// 再跳 Keycloak 登录页——不直接 signinRedirect,避免错过登录说明。
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) await auth.init()

  if (!to.meta.public && !auth.isAuthenticated) {
    if (to.fullPath === '/') return '/login-hint'
    return { path: '/login-hint', query: { redirect: to.fullPath } }
  }
})

export default router
