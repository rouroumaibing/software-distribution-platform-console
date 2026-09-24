<script setup lang="ts">
// 凭据管理（§9.5 / §9.7）：hub 侧 AES-GCM 信封加密 + 幂等种子已落地，这里补齐 console 消费端。
// 凭据值明文只在创建/修改请求里上送，hub 落库前加密；列表/详情只返回 valueSet（不回明文）。
// 编辑时凭据值留空 = 保留现有值（hub Update 已做 read-before-write，避免元数据改动误清密文）。
import { onMounted, reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { credentialApi, type CredentialDTO, type CredentialInput, type KubeParseResult } from '@/api/credential'
import { CREDENTIAL_SCOPE_OPTIONS, CREDENTIAL_TYPE_OPTIONS, credentialScopeLabel, credentialTypeLabel } from '@/utils/credential'
import { toast } from '@/utils/toast'

const creds = ref<CredentialDTO[]>([])
const total = ref(0)
const loading = ref(true)

const modal = ref(false)
const saving = ref(false)
const editId = ref<string | null>(null)
const form = reactive<CredentialInput & { value: string }>({ name: '', type: 'kubeconfig', scope: undefined, scopeId: '', value: '' })
const parseResult = ref<KubeParseResult | null>(null)
const parseErr = ref('')

const scopeOptions = CREDENTIAL_SCOPE_OPTIONS
const typeOptions = CREDENTIAL_TYPE_OPTIONS

async function load() {
  loading.value = true
  try {
    const p = await credentialApi.list(undefined, undefined, { page: 1, pageSize: 100 })
    creds.value = p.items
    total.value = p.total
  } catch (e) {
    toast.err('加载凭据失败：' + msg(e))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editId.value = null
  form.name = ''
  form.type = 'kubeconfig'
  form.scope = undefined
  form.scopeId = ''
  form.value = ''
  parseResult.value = null
  parseErr.value = ''
  modal.value = true
}

function openEdit(c: CredentialDTO) {
  editId.value = c.id
  form.name = c.name
  form.type = c.type
  form.scope = c.scope
  form.scopeId = c.scopeId ?? ''
  form.value = '' // 留空 = 保留现有值
  parseResult.value = null
  parseErr.value = ''
  modal.value = true
}

async function save() {
  if (!form.name.trim()) {
    toast.err('请填写名称')
    return
  }
  saving.value = true
  try {
    const payload: CredentialInput = {
      name: form.name.trim(),
      type: form.type,
      scope: form.scope,
      scopeId: form.scopeId?.trim() || undefined,
    }
    // 仅在填写了值时上送（避免把空串当新值）；编辑留空则 hub 保留现有密文。
    if (form.value.trim()) payload.value = form.value
    if (editId.value) await credentialApi.update(editId.value, payload)
    else await credentialApi.create(payload)
    toast.ok(editId.value ? '已更新凭据' : '已创建凭据')
    modal.value = false
    await load()
  } catch (e) {
    toast.err('保存失败：' + msg(e))
  } finally {
    saving.value = false
  }
}

async function remove(c: CredentialDTO) {
  if (!window.confirm(`删除凭据「${c.name}」？引用它的目标/环境将失去该凭据。`)) return
  try {
    await credentialApi.remove(c.id)
    toast.ok('已删除')
    await load()
  } catch (e) {
    toast.err('删除失败：' + msg(e))
  }
}

// 结构性 kubeconfig 预览（仅当类型为 kubeconfig 且填写了值）。
async function previewKubeconfig() {
  if (form.type !== 'kubeconfig' || !form.value.trim()) return
  parseErr.value = ''
  try {
    parseResult.value = await credentialApi.parseKubeconfig(form.value)
    const errs = parseResult.value.errors || []
    if (errs.length) parseErr.value = errs.join('；')
  } catch (e) {
    parseErr.value = msg(e)
    parseResult.value = null
  }
}

function msg(e: unknown): string {
  const anyE = e as { response?: { data?: { error?: string } }; message?: string }
  return anyE?.response?.data?.error || anyE?.message || '未知错误'
}

const scopeText = (c: CredentialDTO) => (c.scope ? `${credentialScopeLabel(c.scope)}${c.scopeId ? ' · ' + c.scopeId.slice(0, 8) : ''}` : '全局')

onMounted(load)
</script>

<template>
  <div>
    <div class="toolbar">
      <h2 class="h2" style="margin: 0">凭据</h2>
      <div class="spacer"></div>
      <button class="btn btn-pearl" @click="openCreate">＋ 新建凭据</button>
    </div>

    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="creds.length === 0" class="empty">暂无凭据</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>作用域</th>
            <th>已设值</th>
            <th>创建时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in creds" :key="c.id">
            <td><b>{{ c.name }}</b></td>
            <td><span class="chip">{{ credentialTypeLabel(c.type) }}</span></td>
            <td class="mono">{{ scopeText(c) }}</td>
            <td>{{ c.valueSet ? '✓' : '—' }}</td>
            <td class="mono">{{ new Date(c.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
            <td class="row-actions">
              <a @click="openEdit(c)">编辑</a>
              <a style="color: var(--failed-fg)" @click="remove(c)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal :open="modal" :title="editId ? '编辑凭据' : '新建凭据'" @close="modal = false">
      <div class="field">
        <label>名称</label>
        <input v-model="form.name" class="input" type="text" placeholder="如 prod-kubeconfig" />
      </div>
      <div class="field">
        <label>类型</label>
        <select v-model="form.type" class="select">
          <option v-for="t in typeOptions" :key="t" :value="t">{{ credentialTypeLabel(t) }}</option>
        </select>
      </div>
      <div class="field">
        <label>作用域（可选）</label>
        <div style="display: flex; gap: 8px">
          <select v-model="form.scope" class="select" style="flex: 0 0 140px">
            <option :value="undefined">全局</option>
            <option v-for="s in scopeOptions" :key="s" :value="s">{{ credentialScopeLabel(s) }}</option>
          </select>
          <input v-model="form.scopeId" class="input" type="text" :disabled="!form.scope" placeholder="scopeId（目标/环境 UUID）" />
        </div>
      </div>
      <div class="field">
        <label>凭据值{{ editId ? '（留空 = 保留现有值）' : '' }}</label>
        <textarea v-model="form.value" class="input" rows="5" :placeholder="form.type === 'kubeconfig' ? '粘贴 kubeconfig 全文' : '凭据明文（仅内存/请求中存在，落库即加密）'"></textarea>
        <p class="hint">明文只随本次请求上送，hub 落库前 AES-GCM 加密；列表与详情均不回显明文。</p>
        <button v-if="form.type === 'kubeconfig'" class="btn btn-pearl btn-sm" type="button" @click="previewKubeconfig">预览解析</button>
      </div>
      <div v-if="parseResult" class="parse-box">
        <div class="parse-row"><span>Server</span><code>{{ parseResult.server || '—' }}</code></div>
        <div class="parse-row"><span>认证方式</span><code>{{ parseResult.authMethod }}</code></div>
        <div class="parse-row"><span>CA</span><code>{{ parseResult.caPresent ? '有' : '无' }}</code></div>
        <div class="parse-row"><span>当前上下文</span><code>{{ parseResult.currentContext || '—' }}</code></div>
      </div>
      <p v-if="parseErr" class="parse-err">{{ parseErr }}</p>
      <template #foot>
        <button class="btn btn-pearl" @click="modal = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.spacer { flex: 1; }
.h2 { font-size: 15px; font-weight: 700; }
.field { margin-bottom: 14px; }
.field > label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-sub); }
.input, .select { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--radius-card); font-size: 13px; font-family: inherit; background: var(--surface); color: var(--text); }
.field .hint { margin: 4px 0 0; font-size: 12px; color: var(--text-sub); }
.row-actions a { margin-right: 12px; color: var(--accent); cursor: pointer; }
.chip { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; }
.parse-box { border: 1px solid var(--hairline); border-radius: var(--radius-card); padding: 10px 12px; margin-bottom: 10px; }
.parse-row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
.parse-row code { font-size: 12px; }
.parse-err { color: var(--failed-fg); font-size: 12px; margin: 6px 0 0; }
</style>
