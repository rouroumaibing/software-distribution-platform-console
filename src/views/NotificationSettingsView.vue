<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { subscriptionApi, SUBSCRIPTION_EVENTS } from '@/api/notification'
import { toast } from '@/utils/toast'

/**
 * §5.2 通知订阅设置（决策 #5 收敛：本期渠道 = 邮箱）。个人级：hub 无用户表
 * （D3），邮箱由本人在此声明 —— 是「发往我填的地址」，不是通讯录查找。
 * 渠道未配置 SMTP 时 hub 侧分发为 no-op：保存仍成功，页头给出诚实提示。
 */
const email = ref('')
const enabled = ref(true)
const picked = ref<Record<string, boolean>>({})
const loading = ref(true)
const saving = ref(false)

function eventsToPicked(events: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const e of events.split(',')) {
    const k = e.trim()
    if (k) out[k] = true
  }
  return out
}

onMounted(async () => {
  try {
    const s = await subscriptionApi.get()
    email.value = s.email ?? ''
    enabled.value = s.enabled
    picked.value = eventsToPicked(s.events || 'approval_required')
  } catch {
    // 首次无订阅行 = 默认基线（approval_required）
    picked.value = { approval_required: true }
  } finally {
    loading.value = false
  }
})

async function save() {
  if (email.value.trim() && !email.value.includes('@')) {
    toast.err('邮箱格式不正确')
    return
  }
  const events = Object.entries(picked.value)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join(',')
  saving.value = true
  try {
    const s = await subscriptionApi.update({
      email: email.value.trim(),
      events,
      enabled: enabled.value,
    })
    email.value = s.email
    enabled.value = s.enabled
    picked.value = eventsToPicked(s.events || 'approval_required')
    toast.ok('通知订阅已保存')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1>通知订阅</h1>
    <p class="muted">
      站内通知（顶栏铃铛）始终生效；此处配置的是<strong>邮件渠道</strong>——
      平台按你勾选的事件类型，把通知镜像发送到你填写的邮箱。
    </p>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else class="card form-card">
      <label class="row">
        <input v-model="enabled" type="checkbox" />
        <span>启用邮件通知（关闭即静默，配置保留）</span>
      </label>

      <div class="field">
        <label>接收邮箱</label>
        <input v-model="email" class="input" placeholder="name@example.com（留空 = 仅站内）" />
      </div>

      <div class="field">
        <label>订阅事件</label>
        <label v-for="e in SUBSCRIPTION_EVENTS" :key="e.key" class="row">
          <input v-model="picked[e.key]" type="checkbox" />
          <span>{{ e.label }}</span>
        </label>
      </div>

      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存订阅' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; max-width: 640px; }
.form-card { max-width: 520px; display: flex; flex-direction: column; gap: 16px; }
.row { display: flex; align-items: center; gap: 8px; }
.field { display: flex; flex-direction: column; gap: 6px; }
</style>
