<script setup lang="ts">
// 平台管理（IA v2）：用户与平台权限（平台级 RBAC）+ 集群健康。
// 组件级授权在各组件详情的「权限」Tab —— 权限双轨的平台侧半边。
import { onMounted, ref } from 'vue'
import { permissionApi, type User, type Role } from '@/api/permission'
import { clusterApi, type Cluster } from '@/api/cluster'

const props = defineProps<{ section: 'permissions' | 'clusters' }>()

const users = ref<User[]>([])
const roles = ref<Role[]>([])
const clusters = ref<Cluster[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    if (props.section === 'permissions') {
      const [u, r] = await Promise.all([
        permissionApi.users.list({ page: 1, pageSize: 100 }),
        permissionApi.roles.list(),
      ])
      users.value = u.items
      roles.value = r
    } else {
      const c = await clusterApi.list({ page: 1, pageSize: 100 })
      clusters.value = c.items
    }
  } finally {
    loading.value = false
  }
})

function fmtHeartbeat(s?: string) {
  if (!s) return '—'
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000)
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}m 前`
  return `${Math.floor(sec / 3600)}h 前`
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1 class="title">{{ section === 'permissions' ? '用户与平台权限' : '集群' }}</h1>
      <div class="sub">
        平台级管理 · 组件级授权在各组件详情的「权限」Tab
      </div>
    </div>

    <div class="tabs" style="margin-top: 0">
      <router-link class="tab" :class="{ active: section === 'permissions' }" to="/admin/permissions">用户与平台权限</router-link>
      <router-link class="tab" :class="{ active: section === 'clusters' }" to="/admin/clusters">集群</router-link>
    </div>

    <template v-if="section === 'permissions'">
      <div class="toolbar"><div class="spacer"></div><span class="sub">角色是种子数据（Viewer/Editor/Admin），只读</span></div>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="users.length === 0" class="empty">暂无用户（OIDC 登录后自动注册）</div>
        <table v-else class="table">
          <thead><tr><th>用户</th><th>邮箱</th><th>加入时间</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td><b>{{ u.name }}</b></td>
              <td class="mono">{{ u.email }}</td>
              <td class="mono">{{ new Date(u.createdAt).toLocaleDateString('zh-CN') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="h2">系统角色</h2>
      <div class="card flush">
        <div v-if="roles.length === 0" class="empty">暂无系统角色</div>
        <table v-else class="table">
          <thead><tr><th>角色</th><th>权限</th><th>类型</th></tr></thead>
          <tbody>
            <tr v-for="r in roles" :key="r.id">
              <td><b>{{ r.name }}</b></td>
              <td><span v-for="p in r.permissions" :key="p" class="chip" style="margin-right: 6px">{{ p }}</span></td>
              <td>{{ r.isSystem ? '系统内置' : '自定义' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="clusters.length === 0" class="empty">暂无注册集群。Runner 上线后自动注册。</div>
        <table v-else class="table">
          <thead><tr><th>名称</th><th>厂商</th><th>区域</th><th>状态</th><th>Agent 版本</th><th>最近心跳</th></tr></thead>
          <tbody>
            <tr v-for="c in clusters" :key="c.id">
              <td><b>{{ c.name }}</b></td>
              <td>{{ c.vendor || '—' }}</td>
              <td>{{ c.region || '—' }}</td>
              <td>
                <span class="badge" :class="c.status === 'online' ? 'b-succ' : 'b-pend'">
                  <span class="pt"></span>{{ c.status === 'online' ? '在线' : '离线' }}
                </span>
              </td>
              <td class="mono">{{ c.agentVersion || '—' }}</td>
              <td class="mono">{{ fmtHeartbeat(c.lastHeartbeatAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
