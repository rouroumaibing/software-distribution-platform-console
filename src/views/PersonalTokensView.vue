<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { http } from '@/api/http'
import { toast } from '@/utils/toast'

/**
 * §6.4 访问令牌（PAT，S-1 裁定）：明文仅创建时展示一次；列表掩码；
 * 吊销为高危确认（不可恢复）。令牌创建/吊销经审计中间件自动留痕。
 */
interface PAT {
  id: string
  name: string
  prefix: string
  scopes: string
  expiresAt?: string
  lastUsedAt?: string
  createdAt: string
}

const rows = ref<PAT[]>([])
const loading = ref(true)
const createOpen = ref(false)
const cName = ref('')
const cScopes = ref<'read' | 'write'>('write')
const cExpires = ref('')
const creating = ref(false)
const plaintext = ref('') // 仅创建弹窗内一次性展示
const revokeTarget = ref<PAT | null>(null)

async function load() {
  loading.value = true
  try {
    rows.value = await http.get<{ data: PAT[] }>('/me/tokens').then((r) => r.data.data)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function create() {
  creating.value = true
  try {
    const resp = await http
      .post<{ data: { token: PAT; plaintext: string } }>('/me/tokens', {
        name: cName.value.trim(),
        scopes: cScopes.value,
        expiresAt: cExpires.value || undefined,
      })
      .then((r) => r.data.data)
    plaintext.value = resp.plaintext
    createOpen.value = false
    cName.value = ''
    cExpires.value = ''
    await load()
  } finally {
    creating.value = false
  }
}

async function doRevoke() {
  if (!revokeTarget.value) return
  await http.delete(`/me/tokens/${revokeTarget.value.id}`)
  toast.ok(`令牌「${revokeTarget.value.name}」已吊销`)
  revokeTarget.value = null
  await load()
}

const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—')
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 class="title">访问令牌</h1>
      <div class="sub">供 CI / 脚本调用平台 API：<code>Authorization: Bearer sdp_pat_…</code>。明文只在创建时展示一次，请立即保存。</div>
    </div>

    <div class="toolbar" style="margin-top: 0">
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="createOpen = true">＋ 创建令牌</button>
    </div>

    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="rows.length === 0" class="empty">还没有令牌。创建一个用于 CI 或脚本访问。</div>
      <table v-else class="table">
        <thead><tr><th>名称</th><th>令牌</th><th>范围</th><th>过期时间</th><th>最近使用</th><th>创建时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="t in rows" :key="t.id">
            <td><b>{{ t.name }}</b></td>
            <td class="mono">{{ t.prefix }}…</td>
            <td><span class="chip">{{ t.scopes === 'read' ? '只读' : '读写' }}</span></td>
            <td class="mono">{{ fmtDate(t.expiresAt) }}</td>
            <td class="mono">{{ fmtDate(t.lastUsedAt) }}</td>
            <td class="mono">{{ fmtDate(t.createdAt) }}</td>
            <td class="row-actions"><a href="#" @click.prevent="revokeTarget = t">吊销</a></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 创建 -->
    <Modal :open="createOpen" title="创建访问令牌" @close="createOpen = false">
      <div class="field">
        <label>名称 *</label>
        <input v-model="cName" class="input" placeholder="如 github-actions-deploy" />
      </div>
      <div class="field">
        <label>范围</label>
        <select v-model="cScopes" class="select">
          <option value="write">读写（非 GET 全放行）</option>
          <option value="read">只读（仅 GET）</option>
        </select>
      </div>
      <div class="field">
        <label>过期时间（留空 = 永不过期）</label>
        <input v-model="cExpires" class="input" type="datetime-local" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="creating || !cName.trim()" @click="create">
          {{ creating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- 明文一次性展示 -->
    <Modal :open="!!plaintext" title="令牌已创建" @close="plaintext = ''">
      <p class="warn-line">请<strong>立即复制</strong>——关闭后无法再次查看明文，只能吊销重建。</p>
      <div class="plain-box mono">{{ plaintext }}</div>
      <template #foot>
        <button class="btn btn-primary" @click="plaintext = ''">我已保存</button>
      </template>
    </Modal>

    <!-- 吊销（高危确认） -->
    <Modal :open="!!revokeTarget" title="吊销令牌" @close="revokeTarget = null">
      <p>将吊销令牌 <b>{{ revokeTarget?.name }}</b>（{{ revokeTarget?.prefix }}…）。使用该令牌的 CI / 脚本将立即失效，<strong>此操作不可恢复</strong>。</p>
      <template #foot>
        <button class="btn btn-pearl" @click="revokeTarget = null">取消</button>
        <button class="btn btn-primary" @click="doRevoke">确认吊销</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.warn-line { color: var(--warning-fg, #a60); margin-top: 0; }
.plain-box {
  background: var(--surface-2); border: 1px dashed var(--hairline); border-radius: 8px;
  padding: 12px; word-break: break-all; user-select: all; font-size: 13px;
}
</style>
