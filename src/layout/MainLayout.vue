<script setup lang="ts">
// 全局骨架：左侧功能菜单(可折叠) + 顶栏 + router-view。
// 布局决策见设计文档 §7 页面布局：https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/console/CONSOLE-UI-DESIGN.md
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()
const collapsed = ref(false)

interface MenuItem {
  path: string
  label: string
  icon: string
  disabled?: boolean
}

interface MenuGroup {
  label?: string
  items: MenuItem[]
}

// IA v2 菜单（CONSOLE-LAYOUT §2 v2）：4 项。
// 组件/流水线/发布/制品库/环境/日志/组件权限 已收敛进组件详情 Tab；
// 平台权限与集群归入平台管理；运行中心是唯一全局巡视入口。
const groups: MenuGroup[] = [
  {
    items: [
      { path: '/dashboard', label: '总览', icon: '▦' },
      { path: '/service-tree', label: '服务树', icon: '🌲' },
      { path: '/runs', label: '运行中心', icon: '▶' },
    ],
  },
  {
    label: '平台管理',
    items: [
      { path: '/admin/permissions', label: '用户与平台权限', icon: '🔑' },
      { path: '/admin/clusters', label: '集群', icon: '☁' },
    ],
  },
]


// 高亮映射：组件详情前缀归服务树，admin 区分两个子项。
const activePath = computed(() => {
  const p = route.path
  if (p.startsWith('/components/')) return '/service-tree'
  if (p.startsWith('/admin/permissions')) return '/admin/permissions'
  if (p.startsWith('/admin/clusters')) return '/admin/clusters'
  return '/' + (route.path.split('/')[1] ?? '')
})

const userName = computed(() => {
  const p = auth.user?.profile
  return (p?.name as string) || (p?.preferred_username as string) || '用户'
})

async function logout() {
  await auth.logout()
}
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <button class="collapse-btn" :title="collapsed ? '展开菜单' : '折叠菜单'" @click="collapsed = !collapsed">☰</button>
      <div class="logo"><span class="logo-dot"></span>SDP Console</div>
      <div class="top-right">
        <span class="top-icon" title="搜索">🔍</span>
        <span class="top-icon" title="通知">🔔</span>
        <div class="user-chip">
          <span class="avatar">{{ userName.slice(0, 2).toUpperCase() }}</span>
          <span class="uname">{{ userName }}</span>
          <button class="logout" title="退出登录" @click="logout">⏻</button>
        </div>
      </div>
    </header>
    <div class="body">
      <aside class="menu" :class="{ collapsed }">
        <template v-for="(g, gi) in groups" :key="gi">
          <div v-if="g.label" class="menu-group" :class="{ collapsed }">{{ g.label }}</div>
          <router-link
            v-for="m in g.items"
            :key="m.path"
            :to="m.path"
            class="menu-item"
            :class="{ active: activePath === m.path }"
            :title="collapsed ? m.label : ''"
          >
            <span class="mi">{{ m.icon }}</span>
            <span v-if="!collapsed" class="ml">{{ m.label }}</span>
          </router-link>
        </template>
      </aside>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout { height: 100vh; display: flex; flex-direction: column; }
.topbar {
  height: 56px; flex: 0 0 56px; background: #fff; border-bottom: 1px solid var(--hairline);
  display: flex; align-items: center; padding: 0 16px; gap: 14px; z-index: 50;
}
.collapse-btn {
  width: 34px; height: 34px; border: none; border-radius: 8px; background: none;
  font-size: 16px; cursor: pointer; color: var(--sub);
}
.collapse-btn:hover { background: var(--parchment); }
.logo { font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 8px; }
.logo-dot { width: 18px; height: 18px; border-radius: 5px; background: var(--action-blue); }
.top-right { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.top-icon { cursor: pointer; color: var(--sub); font-size: 16px; }
.user-chip { display: flex; align-items: center; gap: 8px; }
.avatar {
  width: 30px; height: 30px; border-radius: 50%; background: var(--near-black);
  color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 600;
}
.uname { font-size: 13px; }
.logout { background: none; border: none; cursor: pointer; color: var(--sub); font-size: 14px; }
.logout:hover { color: var(--failed-fg); }

.body { flex: 1; display: flex; min-height: 0; }
.menu {
  width: 220px; flex: 0 0 auto; background: var(--menu-bg);
  padding: 12px 8px; overflow-y: auto; transition: width 0.2s ease;
}
.menu.collapsed { width: 64px; }
.menu-group {
  font-size: 11px; color: rgba(255, 255, 255, 0.4); text-transform: uppercase;
  letter-spacing: 0.06em; font-weight: 600; margin: 14px 14px 4px;
}
.menu-group.collapsed { text-align: center; margin: 14px 0 4px; font-size: 10px; letter-spacing: 0; }
.menu-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; margin-bottom: 2px; border-radius: 8px;
  color: rgba(255, 255, 255, 0.75); font-size: 14px; position: relative;
}
.menu-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.menu-item.active { background: var(--menu-active); color: #fff; font-weight: 600; }
.menu-item.active::before {
  content: ""; position: absolute; left: -8px; top: 6px; bottom: 6px;
  width: 3px; border-radius: 2px; background: #4da3ff;
}
.mi { width: 20px; text-align: center; font-size: 15px; flex: 0 0 20px; }
.content { flex: 1; overflow-y: auto; padding: 24px 28px; }
.content > * { max-width: 1280px; margin: 0 auto; }
</style>
