<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 登录说明页：console 不自建登录表单，认证仍由 Keycloak 托管（auth.login() 跳转）。
// 本页只做两件事：展示部署侧预置的默认账号（批注为临时密码、提示登录后重置），
// 提供「继续登录」入口。凭证值来自运行时配置 VITE_LOGIN_HINT_*（console chart
// values auth.loginHintUser/loginHintPassword 经 config.js 注入），与 hub chart
// keycloak-realm-configmap.yaml 的预置用户同源——改动须两处同步；为空则不展示凭证块。
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const target = computed(() => {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') ? r : '/'
})

// 已登录者误入（手动敲 /login-hint）不停留，直接送回目标页。
if (auth.isAuthenticated) router.replace(target.value)

// Keycloak 账户控制台（重置密码入口）：与 issuer 同源的 /account。
const accountUrl = computed(() =>
  auth.keycloakIssuer ? `${auth.keycloakIssuer.replace(/\/$/, '')}/account` : '',
)

async function continueLogin() {
  await auth.login()
}
</script>

<template>
  <div class="login-hint">
    <div class="card">
      <h1>登录说明</h1>
      <p>本平台认证由 Keycloak 托管，点击下方按钮后跳转到登录页。</p>
      <template v-if="auth.loginHintUser">
        <p>部署时预置了以下默认账号（本地 / 演示环境）：</p>
        <table class="cred">
          <tbody>
            <tr><th>用户名</th><td><code>{{ auth.loginHintUser }}</code></td></tr>
            <tr v-if="auth.loginHintPassword"><th>初始密码</th><td><code>{{ auth.loginHintPassword }}</code></td></tr>
          </tbody>
        </table>
        <p class="warn">⚠️ <strong>这是临时初始密码，仅供首次登录。</strong>登录后请立即重置密码，再继续使用平台。</p>
        <p v-if="accountUrl" class="reset">
          重置入口：<a :href="accountUrl" target="_blank" rel="noopener">Keycloak 账户控制台</a>（登录后可改密）。
        </p>
      </template>
      <p v-else class="warn">⚠️ 默认账号见部署文档；若使用临时初始密码，登录后请立即重置。</p>
      <button class="go" type="button" @click="continueLogin">继续登录 →</button>
    </div>
  </div>
</template>

<style scoped>
.login-hint { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f6f8; }
.card { width: 420px; background: #fff; border: 1px solid #e3e5ea; border-radius: 10px; padding: 28px 32px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05); }
h1 { font-size: 18px; margin: 0 0 12px; }
p { font-size: 13px; color: #444; line-height: 1.7; margin: 8px 0; }
.cred { width: 100%; border-collapse: collapse; margin: 12px 0; }
.cred th, .cred td { border: 1px solid #e3e5ea; padding: 6px 10px; font-size: 13px; text-align: left; }
.cred th { width: 88px; background: #fafbfc; color: #666; font-weight: 500; }
code { background: #f0f2f5; padding: 2px 6px; border-radius: 4px; font-size: 12.5px; }
.warn { background: #fff7e6; border: 1px solid #ffe0b0; border-radius: 6px; padding: 10px 12px; color: #8a5a00; }
.reset a { color: #2456c4; }
.go { margin-top: 16px; width: 100%; padding: 10px 0; font-size: 14px; border: none; border-radius: 6px; background: #2456c4; color: #fff; cursor: pointer; }
.go:hover { background: #1d47a6; }
</style>
