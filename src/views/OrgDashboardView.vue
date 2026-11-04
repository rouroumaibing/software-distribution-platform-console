<script setup lang="ts">
// 组织工作台（ACCESS-CONTROL §6，L2：org_admin）。
// 守卫已在 router.beforeEach 施加：须为 ?org=<slug> 对应组织的 org_admin，否则 → /forbidden。
// 本页做客户端二次校验并展示组织作用域入口占位（后续组织级资源在此承载）。
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()

const org = computed(() => String(route.query.org ?? ''))
const isAdmin = computed(() => org.value !== '' && auth.orgAdmins.includes(org.value))
</script>

<template>
  <section class="page">
    <header class="head">
      <h1>组织工作台 · {{ org || '—' }}</h1>
      <p class="muted" v-if="isAdmin">
        你是组织 <b>{{ org }}</b> 的管理员（L2：<code>org_admin</code>）。
      </p>
      <p class="muted" v-else>当前账号不是组织 {{ org }} 的管理员。</p>
    </header>
    <div class="cards">
      <div class="card">
        <span class="ct">组织资源</span>
        <span class="cd">组织作用域内的组件、环境与流水线（待接入）。</span>
      </div>
      <div class="card">
        <span class="ct">组织成员</span>
        <span class="cd">用户组与成员管理（ACCESS-CONTROL §4 / §5）。</span>
      </div>
      <div class="card">
        <span class="ct">集群权限</span>
        <span class="cd">为该组织签发 RoleBinding / kubeconfig（ACCESS-CONTROL §7）。</span>
      </div>
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
  border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface); color: var(--text);
}
.ct { font-size: 15px; font-weight: 600; }
.cd { font-size: 12.5px; color: var(--text-sub); line-height: 1.5; }
</style>
