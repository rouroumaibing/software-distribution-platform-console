<script setup lang="ts">
// 组件详情容器（IA v2）：全屏页面，页头 + Tab 导航（子路由）+ <router-view>。
// Tab 内容在 ./tabs/ 下，各自按 componentId 加载数据。
// 路由表见 router/index.ts /components/:id 子路由（CONSOLE-LAYOUT §3.3 v2）。
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { componentApi, type Component } from '@/api/component'

const route = useRoute()
const router = useRouter()
const componentId = route.params.id as string

const component = ref<Component>()
const loading = ref(true)

onMounted(async () => {
  try {
    component.value = await componentApi.get(componentId)
  } finally {
    loading.value = false
  }
})

// 服务树上溯链（面包屑用）：component → service → tree 由后端 M1 暂不回传，
// 先展示 repoUrl；树链后续由 ServiceTreeView 跳转时经 query 传入。
const crumb = computed(() => {
  const from = route.query.from as string
  return from || '服务树'
})

const tabs = [
  { path: 'overview', label: '概览' },
  { path: 'config', label: '配置' },
  { path: 'pipelines', label: '流水线' },
  { path: 'runs', label: '运行' },
  { path: 'releases', label: '发布' },
  { path: 'artifacts', label: '制品' },
  { path: 'environments', label: '环境' },
  { path: 'permissions', label: '权限' },
  { path: 'logs', label: '日志' },
]

const activeTab = computed(() => (route.name as string)?.replace('component-', '') ?? 'overview')
</script>

<template>
  <div>
    <div v-if="loading" class="loading">加载中…</div>
    <template v-else-if="component">
      <div class="crumb">
        <a @click="router.push('/service-tree')">← {{ crumb }}</a>
        &nbsp;/&nbsp; <b>{{ component.name }}</b>
      </div>

      <div class="page-head">
        <h1 class="title">{{ component.name }}</h1>
        <div class="sub">
          <span class="mono">{{ component.repoUrl }}</span>
          <span v-if="component.language"> · {{ component.language }}</span>
          <span v-if="component.defaultBranch"> · 默认分支 <span class="mono">{{ component.defaultBranch }}</span></span>
        </div>
      </div>

      <div class="tabs">
        <router-link
          v-for="t in tabs"
          :key="t.path"
          class="tab"
          :class="{ active: activeTab === t.path }"
          :to="`/components/${componentId}/${t.path}`"
        >{{ t.label }}</router-link>
      </div>

      <router-view :component-id="componentId" />
    </template>
    <div v-else class="empty">组件不存在或已被删除</div>
  </div>
</template>
