<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 认证回调：
// - 检测「本次登录刚完成 UPDATE_PASSWORD」（§7.15 首登强制改密闭环）→ 主动登出，
//   经 Keycloak post_logout_redirect_uri 回 console 首页，未认证守卫再送进登录页，
//   用户用新密码重新登录——改密后不直接进后台是硬性 UX 要求。
// - 正常登录 → 按 signinRedirect 携带的 state（登录前目标路由）回跳，缺省 '/'。
const auth = useAuthStore()
const router = useRouter()

onMounted(async () => {
  let target = '/'
  try {
    const changed = await auth.handleCallback()
    if (changed) {
      await auth.logout()
      return
    }
    const st = auth.user?.state
    if (typeof st === 'string' && st.startsWith('/')) target = st
  } catch {
    // 回调异常（state 校验失败 / 过期等）→ 落首页，由未认证守卫接管。
  }
  router.replace(target)
})
</script>

<template>
  <div>正在登录...</div>
</template>
