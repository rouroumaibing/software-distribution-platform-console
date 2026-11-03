<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore, AuthError } from '@/stores/auth'

// 自有登录页（AUTH-ARCHITECTURE.md §9 / ui-05 §7.15.1）：
// - state.mode = login：用户名 + 密码 → POST /api/auth/login
//   - 200 → 入系统
//   - 400 reason=UPDATE_PASSWORD → 切 updatePassword 模式（URL 不变）
//   - 401 → 凭据无效提示
// - state.mode = updatePassword：原密码 + 新密码 + 确认 → POST /api/auth/password
//   - 200 → 切回 login 模式，提示用新密码登录
// - 「SSO 登录」走 Flow B：GET /api/auth/login-url → 跳 KC 托管页
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

async function onSSO() {
  errorMsg.value = ''
  try {
    const { loginUrl } = await auth.getLoginUrl()
    window.location.assign(loginUrl)
  } catch {
    errorMsg.value = '无法发起 SSO 登录，请重试'
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h2>SDP 软件分发平台</h2>

      <div v-if="auth.mode === 'login'">
        <form @submit.prevent="onLogin">
          <input v-model="username" placeholder="用户名" autocomplete="username" required />
          <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" required />
          <button type="submit" :disabled="loading">登录</button>
        </form>
        <button class="sso-btn" @click="onSSO" :disabled="loading">SSO 登录</button>
      </div>

      <div v-else>
        <p class="hint">设置新密码</p>
        <form @submit.prevent="onChangePassword">
          <input v-model="oldPassword" type="password" placeholder="原密码" autocomplete="current-password" required />
          <input v-model="newPassword" type="password" placeholder="新密码" autocomplete="new-password" required />
          <input v-model="confirmPassword" type="password" placeholder="确认新密码" autocomplete="new-password" required />
          <button type="submit" :disabled="loading">提交</button>
        </form>
      </div>

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
.sso-btn {
  margin-top: 8px;
  background: #fff;
  color: #1976d2;
  border: 1px solid #1976d2;
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
