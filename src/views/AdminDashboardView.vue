<script setup lang="ts">
// 平台管理面入口（ACCESS-CONTROL §6，L1：platform-admin）。
// 守卫已在 router.beforeEach 施加（非 platform-admin → /forbidden）。本页只做平台级
// 入口聚合：展示当前平台角色并链接到既有管理子页（权限/接入/凭据/审计/设置/审批）。
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const sections = [
  { path: '/admin/permissions', label: '用户与平台权限', desc: '用户 / 用户组 / 组织与平台角色绑定' },
  { path: '/admin/targets', label: '接入管理', desc: '目标集群接入与凭据' },
  { path: '/admin/credentials', label: '凭据管理', desc: '平台级凭据存储' },
  { path: '/admin/audit', label: '平台审计日志', desc: '平台操作审计' },
  { path: '/admin/settings', label: '平台设置', desc: '平台全局配置' },
  { path: '/admin/upgrade-approvals', label: '升级审批', desc: '组件升级审批流' },
]
</script>

<template>
  <section class="page">
    <header class="head">
      <h1>平台管理台</h1>
      <p class="muted">
        平台级管理面（L1：<code>platform-admin</code>）。当前平台角色：
        <b>{{ auth.roles.join('、') || '—' }}</b>
      </p>
    </header>
    <div class="cards">
      <router-link v-for="s in sections" :key="s.path" :to="s.path" class="card">
        <span class="ct">{{ s.label }}</span>
        <span class="cd">{{ s.desc }}</span>
      </router-link>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 20px; }
.head h1 { font-size: 22px; margin: 0 0 6px; color: var(--text); }
.muted { color: var(--text-sub); font-size: 13px; margin: 0; }
.muted code { font-family: var(--mono); background: var(--surface-3); padding: 1px 6px; border-radius: 5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.card {
  display: flex; flex-direction: column; gap: 6px; padding: 16px;
  border: 1px solid var(--hairline); border-radius: 12px; text-decoration: none;
  background: var(--surface); color: var(--text); transition: border-color 0.13s, background 0.13s;
}
.card:hover { border-color: var(--accent); background: var(--accent-soft); }
.ct { font-size: 15px; font-weight: 600; }
.cd { font-size: 12.5px; color: var(--text-sub); line-height: 1.5; }
</style>
