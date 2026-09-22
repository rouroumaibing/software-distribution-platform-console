<script setup lang="ts">
// 全局骨架：左侧导航栏（268 → 64 折叠）+ 右列（顶栏 56 + 内容区）。
// 布局决策见设计文档 §7.1 全局骨架 / §5.1 左栏结构 / §9.2 令牌：
// https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/console/CONSOLE-UI-DESIGN.md
//
// 本轮（C-02 暗色主题）对左栏的两处纠正，对齐 §7.1 / §9.2：
//   ① 底色由硬编码海军蓝 `#001529` 改为 `--rail-bg`（light=surface / dark=#141720）——
//      §9.2 的 P4「消除海军蓝割裂」：内容与导航共用同一套令牌，light 全浅、dark 全深；
//      原实现是固定深蓝，等于暗色主题下唯一"不跟着变"的一块，且与 light 相冲突。
//   ② 去掉选中项的 3px 竖条（§7.1 / §9.5 明令"不用 3px 竖条"），改为
//      「圆角块 + --rail-active-bg 底 + --rail-active-fg 字」。
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { toggleGray, toggleTheme, useTheme } from '@/composables/useTheme'
import { themeToggleLabel, themeToggleTitle } from '@/utils/theme'
import { openPalette } from '@/composables/useGlobalSearch'

const route = useRoute()
const auth = useAuthStore()
const { theme } = useTheme()
const collapsed = ref(false)

// 图标是**本地常量**的 SVG 片段（不含任何用户输入），故可安全用 v-html 注入；
// 路径照抄原型 CONSOLE-UI-原型.html 的 ICON 表，线宽/圆角由 CSS 统一控制。
const ICON = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers: '<polygon points="12 3 21 8 12 13 3 8"/><polyline points="3 13 12 18 21 13"/>',
  play: '<polygon points="7 4.5 19.5 12 7 19.5 7 4.5"/>',
  shield: '<path d="M12 3l7 3v6c0 4.6-3 7.9-7 9-4-1.1-7-4.4-7-9V6z"/>',
  cloud: '<path d="M7 18h9.5a3.8 3.8 0 0 0 .3-7.6A5.2 5.2 0 0 0 7 9.4 3.6 3.6 0 0 0 7 18z"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="17" y1="17" x2="19" y2="19"/><line x1="5" y1="19" x2="7" y2="17"/><line x1="17" y1="7" x2="19" y2="5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
} as const

interface MenuItem {
  path: string
  label: string
  icon: keyof typeof ICON
  disabled?: boolean
}

interface MenuGroup {
  label?: string
  items: MenuItem[]
}

// IA v4.4 菜单（§5.1 设计铁律 S5）：**恒 5 项**
// 3(主区: 总览/服务树/运行中心) + 2(平台管理: 用户与权限/接入管理)。
// 与 Org/Service/Component 数量无关，也与用户行为无关 —— 资源树、"最近访问"
// 一律不许进左栏；跨组件直达由顶栏 ⌘K 承担（§5.1.1）。
const groups: MenuGroup[] = [
  {
    items: [
      { path: '/dashboard', label: '总览', icon: 'grid' },
      { path: '/service-tree', label: '服务树', icon: 'layers' },
      { path: '/runs', label: '运行中心', icon: 'play' },
    ],
  },
  {
    label: '平台管理',
    items: [
      { path: '/admin/permissions', label: '用户与权限', icon: 'shield' },
      { path: '/admin/targets', label: '接入管理', icon: 'cloud' },
    ],
  },
]

// 高亮映射：组件详情前缀归服务树，admin 区分两个子项。
const activePath = computed(() => {
  const p = route.path
  if (p.startsWith('/components/')) return '/service-tree'
  if (p.startsWith('/admin/permissions')) return '/admin/permissions'
  if (p.startsWith('/admin/targets')) return '/admin/targets'
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
  <div class="app">
    <aside class="rail" :class="{ collapsed }">
      <div class="rail-head">
        <div class="brand">
          <span class="brand-dot"></span>
          <span v-if="!collapsed" class="nlabel">SDP Console</span>
        </div>
        <button
          class="collapse"
          :title="collapsed ? '展开菜单' : '折叠菜单'"
          :aria-expanded="!collapsed"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? '»' : '«' }}
        </button>
      </div>
      <nav class="rail-body">
        <template v-for="(g, gi) in groups" :key="gi">
          <div v-if="g.label" class="rgroup">{{ g.label }}</div>
          <router-link
            v-for="m in g.items"
            :key="m.path"
            :to="m.path"
            class="nav-item"
            :class="{ active: activePath === m.path }"
            :title="collapsed ? m.label : ''"
          >
            <!-- eslint-disable-next-line vue/no-v-html -- 内容是本地常量 ICON 表 -->
            <span class="ni" v-html="`<svg viewBox='0 0 24 24'>${ICON[m.icon]}</svg>`"></span>
            <span v-if="!collapsed" class="nlabel">{{ m.label }}</span>
          </router-link>
        </template>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="tb-right">
          <button class="search" title="全局搜索（⌘K）" @click="openPalette()">
            <span class="si" v-html="`<svg viewBox='0 0 24 24'>${ICON.search}</svg>`"></span>
            搜索组件 / 流水线…
            <span class="kbd">⌘K</span>
          </button>
          <button class="tbtn" :title="themeToggleTitle(theme.theme)" @click="toggleTheme()">
            <span
              class="si"
              v-html="`<svg viewBox='0 0 24 24'>${theme.theme === 'dark' ? ICON.sun : ICON.moon}</svg>`"
            ></span>
            {{ themeToggleLabel(theme.theme) }}
          </button>
          <button
            class="tbtn"
            :class="{ on: theme.gray }"
            title="灰阶模式（验证状态在无彩色下是否仍可辨，§9.6）"
            @click="toggleGray()"
          >
            灰阶
          </button>
          <div class="user-chip">
            <span class="avatar">{{ userName.slice(0, 2).toUpperCase() }}</span>
            <span class="uname">{{ userName }}</span>
            <button class="logout" title="退出登录" @click="logout">⏻</button>
          </div>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; height: 100vh; overflow: hidden; }

/* ---------- 左栏（§5.1 / §7.1 / §9.2） ---------- */
.rail {
  width: 268px; flex: 0 0 268px; background: var(--rail-bg);
  border-right: 1px solid var(--hairline);
  display: flex; flex-direction: column; overflow: hidden;
  transition: width 0.18s ease, background-color 0.15s ease, border-color 0.15s ease;
}
.rail.collapsed { width: 64px; flex-basis: 64px; }
.rail-head {
  height: 56px; flex: 0 0 56px; display: flex; align-items: center; gap: 10px;
  padding: 0 16px; border-bottom: 1px solid var(--hairline-2);
}
.brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 15px; white-space: nowrap; color: var(--text); }
.brand-dot { width: 20px; height: 20px; border-radius: 6px; background: var(--accent); flex: 0 0 20px; }
.collapse {
  margin-left: auto; border: none; background: none; color: var(--text-sub);
  cursor: pointer; font-size: 15px; padding: 4px 6px; border-radius: 7px;
}
.collapse:hover { background: var(--rail-hover); }
.rail-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 10px 8px; }
.rgroup {
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--rail-group); font-weight: 600; margin: 12px 10px 5px; white-space: nowrap;
}
.nav-item {
  display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: 9px;
  color: var(--rail-item); font-size: 14px; white-space: nowrap;
  transition: background 0.13s, color 0.13s;
}
.nav-item:hover { background: var(--rail-hover); }
/* 选中态 = 圆角块 + accent-soft 底 + accent 字；**不用 3px 竖条**（§7.1 / §9.5） */
.nav-item.active { background: var(--rail-active-bg); color: var(--rail-active-fg); font-weight: 600; }
.nav-item .ni { width: 19px; height: 19px; flex: 0 0 19px; display: grid; place-items: center; }
.nav-item .ni :deep(svg) {
  width: 18px; height: 18px; stroke: currentColor; fill: none;
  stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
}
.rail.collapsed .nlabel, .rail.collapsed .rgroup { display: none; }
.rail.collapsed .nav-item { justify-content: center; padding: 9px 0; }

/* ---------- 顶栏（§7.1：56px + 底部 hairline + 右侧控件组） ---------- */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar {
  height: 56px; flex: 0 0 56px; background: var(--surface);
  border-bottom: 1px solid var(--hairline);
  display: flex; align-items: center; gap: 14px; padding: 0 22px;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.tb-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.search {
  display: flex; align-items: center; gap: 7px; background: var(--surface-3);
  border: 1px solid transparent; border-radius: 9px; padding: 7px 12px;
  color: var(--text-sub); font-size: 13px; min-width: 210px; cursor: pointer;
  font-family: var(--font);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.search:hover { background: var(--surface-2); color: var(--text); }
.search .kbd {
  margin-left: auto; font-family: var(--mono); font-size: 11px;
  border: 1px solid var(--hairline); border-radius: 5px; padding: 1px 5px;
  color: var(--text-sub);
}
.tbtn {
  border: 1px solid var(--hairline); background: var(--surface); color: var(--text-sub);
  border-radius: 9px; padding: 7px 10px; cursor: pointer; font-size: 12.5px;
  display: inline-flex; align-items: center; gap: 6px; font-family: var(--font);
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.tbtn:hover { background: var(--surface-2); color: var(--text); }
.tbtn.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.si { display: inline-flex; }
.si :deep(svg) { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; }

.user-chip { display: flex; align-items: center; gap: 8px; margin-left: 6px; }
.avatar {
  width: 30px; height: 30px; border-radius: 50%; background: var(--accent);
  color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 700;
}
.uname { font-size: 13px; color: var(--text); }
.logout { background: none; border: none; cursor: pointer; color: var(--text-sub); font-size: 14px; }
.logout:hover { color: var(--failed-fg); }

/* ---------- 内容区（§7.1：padding 24 · max-width 1280） ---------- */
.content { flex: 1; overflow-y: auto; padding: 24px 28px; }
.content > * { max-width: 1280px; margin: 0 auto; }
</style>
