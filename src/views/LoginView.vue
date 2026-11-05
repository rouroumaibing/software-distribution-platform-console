<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore, AuthError } from '@/stores/auth'
import { authApi } from '@/api/auth'

// 自有登录页（AUTH-ARCHITECTURE.md §9 / ui-05 §7.15.1）：协议层 login 模式
// （GET /api/auth/config，未登录态可读）决定入口形态 —— 单一入口，废弃旧版
// 「登录 + SSO 登录」双按钮：
// - default：自研用户名 + 密码表单（Flow A）→ POST /api/auth/login
//     - 200 → 入系统
//     - 400 reason=UPDATE_PASSWORD → 切 updatePassword 模式（URL 不变）
//     - 401 → 凭据无效提示
// - keycloak：OIDC code 流（Flow B，带 SSO）→ 页面挂载即取 KC 登录 URL 并跳转，
//     表单不渲染（强制改密等由 Keycloak 自身承接）。
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)
const redirecting = ref(false)

onMounted(async () => {
  try {
    const cfg = await authApi.authConfig()
    if (cfg.login === 'keycloak') {
      redirecting.value = true
      const { loginUrl } = await auth.getLoginUrl()
      window.location.assign(loginUrl)
    }
  } catch {
    // 取配置 / 取 KC URL 失败 → 退化到自研表单，避免登录页卡死。
    redirecting.value = false
  }
})

async function onLogin() {
  errorMsg.value = ''
  loading.value = true
  try {
    await auth.login(username.value, password.value)
    const redirect = (route.query.redirect as string) || '/'
    router.replace(redirect)
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.reason === 'UPDATE_PASSWORD') {
        // store 已切 mode=updatePassword；预填原密码字段
        oldPassword.value = password.value
        errorMsg.value = '首次登录或密码已被重置，请设置新密码'
      } else if (e.reason === 'INVALID_CREDENTIALS') {
        errorMsg.value = '用户名或密码错误'
      } else {
        errorMsg.value = e.reason
      }
    } else {
      errorMsg.value = '登录失败，请重试'
    }
  } finally {
    loading.value = false
  }
}

async function onChangePassword() {
  errorMsg.value = ''
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的新密码不一致'
    return
  }
  loading.value = true
  try {
    await auth.changePassword(oldPassword.value, newPassword.value)
    // 改密成功：切回 login 模式（store 已切），清敏感字段，提示用新密码登录
    password.value = ''
    oldPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    errorMsg.value = '密码已修改，请用新密码登录'
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    if (status === 401) errorMsg.value = '原密码错误'
    else if (status === 400) errorMsg.value = '新密码不符合要求'
    else errorMsg.value = '修改密码失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h2>SDP 软件分发平台</h2>

      <div v-if="redirecting" class="hint">正在跳转到单点登录…</div>

      <template v-else>
        <div v-if="auth.mode === 'login'">
          <form @submit.prevent="onLogin">
            <input v-model="username" placeholder="用户名" autocomplete="username" required />
            <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" required />
            <button type="submit" :disabled="loading">登录</button>
          </form>
        </div>

        <div v-else>
          <p class="hint">设置新密码</p>
          <form @submit.prevent="onChangePassword">
            <input v-model="newPassword" type="password" placeholder="新密码" autocomplete="new-password" required />
            <input v-model="confirmPassword" type="password" placeholder="确认新密码" autocomplete="new-password" required />
            <button type="submit" :disabled="loading">提交</button>
          </form>
        </div>
      </template>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f5f5f5;
}
.login-card {
  width: 320px;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  background: #fff;
}
.login-card h2 {
  text-align: center;
  margin-bottom: 16px;
  font-size: 18px;
}
input {
  display: block;
  width: 100%;
  margin-bottom: 12px;
  padding: 8px;
  box-sizing: border-box;
  border: 1px solid #ddd;
  border-radius: 4px;
}
button {
  width: 100%;
  padding: 8px;
  cursor: pointer;
  border: none;
  border-radius: 4px;
  background: #1976d2;
  color: #fff;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.hint {
  color: #666;
  margin-bottom: 12px;
  text-align: center;
}
.error {
  color: #d32f2f;
  margin-top: 8px;
  font-size: 13px;
  text-align: center;
}
</style>
