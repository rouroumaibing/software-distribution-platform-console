<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// Flow B 回调（AUTH-ARCHITECTURE.md §2 Flow B）：Keycloak 登录成功后回到
// redirect_uri?code&state。检测 code → POST /api/auth/session/code 交换会话。
// 成功入系统；失败（state 不匹配 / code 过期 / 后端错误）回登录页。
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

onMounted(async () => {
  const code = route.query.code as string | undefined
  const state = route.query.state as string | undefined
  if (!code || !state) {
    router.replace('/user/login')
    return
  }
  try {
    await auth.handleOAuthCallback(code, state)
    router.replace('/')
  } catch {
    router.replace('/user/login')
  }
})
</script>

<template>
  <div>正在登录...</div>
</template>
