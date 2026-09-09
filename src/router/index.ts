import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 路由表（IA v2，CONSOLE-LAYOUT §4 v2）：
// 左侧菜单 4 项（总览/服务树/运行中心/平台管理）；
// 组件详情 = /components/:id 全屏子路由 Tab（概览/配置/流水线/运行/发布/制品/环境/权限/日志）。
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

        // ---- 运行中心（唯一全局巡视入口）----
        { path: 'runs', component: () => import('@/views/RunCenterView.vue'), meta: { title: '运行中心' } },

        // ---- 下钻路由（保持不变）----
        { path: 'pipelines/:id', component: () => import('@/views/PipelineEditorView.vue'), meta: { title: '流水线编排' } },
        { path: 'pipelines/:id/runs', component: () => import('@/views/RunListView.vue'), meta: { title: '运行历史' } },
        { path: 'pipelines/:pipelineId/runs/:runId', component: () => import('@/views/RunMonitorView.vue'), meta: { title: '运行监控' } },
        { path: 'releases/:id', component: () => import('@/views/ReleaseDetailView.vue'), meta: { title: '灰度发布' } },

        // ---- 平台管理 ----
        { path: 'admin/permissions', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'permissions' }, meta: { title: '用户与平台权限' } },
        { path: 'admin/clusters', component: () => import('@/views/PlatformAdminView.vue'), props: { section: 'clusters' }, meta: { title: '集群' } },

        // ---- 旧 flat 菜单路由 → redirect（deep link 兼容）----
        { path: 'components', redirect: '/service-tree' },
        { path: 'pipelines', redirect: '/service-tree' },
        { path: 'releases', redirect: '/runs' },
        { path: 'artifacts', redirect: '/service-tree' },
        { path: 'environments', redirect: '/admin/clusters' },
        { path: 'permissions', redirect: '/admin/permissions' },
        { path: 'logs', redirect: '/service-tree' },
      ],
    },
  ],
})

// 除了标了 meta.public 的路由(比如 OIDC 回调页),其余一律要求已登录,
// 未登录直接跳去 Keycloak 登录页而不是显示一个空白/报错页面。
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) await auth.init()

  if (!to.meta.public && !auth.isAuthenticated) {
    await auth.login()
    return false
  }
})

export default router
