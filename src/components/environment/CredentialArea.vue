<script setup lang="ts">
// §7.12.3/§7.12.4 凭据区：按 access 分流；敏感字段单向（只回显 valueSet，不返明文）。
// agent 不需要凭据；kubeconfig 三选一（引用 / 粘贴 / 手工）；ssh 主机清单 + 凭据引用。
import { ref, computed, watch } from 'vue'
import { toast } from '@/utils/toast'
import {
  credentialApi,
  type EnvAccess,
  type EnvAccessConfig,
  type KubeParseResult,
  type Credential,
} from '@/api/environment'

const props = defineProps<{
  access: EnvAccess
  config: EnvAccessConfig
  credentials: Credential[]
  envId: string
}>()

const emit = defineEmits<{ 'update:config': [cfg: EnvAccessConfig] }>()

// 本地草稿：config 变化时同步进来
const draft = ref<EnvAccessConfig>({ ...(props.config || {}) })
watch(
  () => props.config,
  (c) => { draft.value = { ...(c || {}) } },
  { deep: true },
)
function patch(p: Partial<EnvAccessConfig>) {
  draft.value = { ...draft.value, ...p }
  emit('update:config', draft.value)
}

const kubeCreds = computed(() => props.credentials.filter((c) => c.type === 'kubeconfig'))
const sshCreds = computed(() => props.credentials.filter((c) => c.type === 'ssh-key' || c.type === 'ssh-password'))

const kubeSource = ref<'' | 'ref' | 'paste' | 'manual'>(draft.value.kubeSource ?? 'ref')
function setKubeSource(s: 'ref' | 'paste' | 'manual') {
  kubeSource.value = s
  patch({ kubeSource: s })
}

const pasteRaw = ref('')
const parseResult = ref<KubeParseResult | null>(null)
const parsing = ref(false)
const savedCredId = ref('')

async function parseKube() {
  if (!pasteRaw.value.trim()) { toast.err('请先粘贴 kubeconfig 内容'); return }
  parsing.value = true
  try {
    parseResult.value = await credentialApi.parseKubeconfig(pasteRaw.value)
    if (parseResult.value.errors.length) toast.err('解析发现问题，请查看下方提示')
    else toast.ok('解析通过：已识别 apiserver 与认证方式')
  } catch (e: any) {
    toast.err('解析失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally { parsing.value = false }
}

async function savePastedAsCredential() {
  if (!parseResult.value || parseResult.value.errors.length) { toast.err('请先完成有效解析'); return }
  try {
    const c = await credentialApi.create({
      name: `kubeconfig-${Date.now()}`,
      type: 'kubeconfig',
      scope: 'environment',
      scopeId: props.envId,
      value: pasteRaw.value,
    })
    savedCredId.value = c.id
    patch({ kubeSource: 'ref', kubeCredRef: c.id })
    toast.ok('凭据已保存（明文不再留存，仅记引用）')
    pasteRaw.value = ''
  } catch (e: any) {
    toast.err('凭据保存失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  }
}

// SSH 主机清单
interface HostRow {
  host: string
  port?: number
  user: string
  authType?: 'password' | 'key'
  secretRef?: string
  bastion?: string
}
const hosts = ref<HostRow[]>(
  (draft.value.sshTargets || []).map((h) => ({ ...h })),
)
function syncHosts() {
  patch({ sshTargets: hosts.value.map((h) => ({ ...h })) })
}
function addHost() { hosts.value.push({ host: '', port: 22, user: '', authType: 'key', secretRef: '', bastion: '' }); syncHosts() }
function removeHost(i: number) { hosts.value.splice(i, 1); syncHosts() }

const selectedCredName = computed(() => {
  const id = draft.value.kubeCredRef || savedCredId.value
  return props.credentials.find((c) => c.id === id)?.name ?? (id ? '已配置' : '')
})
</script>

<template>
  <div class="cred-area">
    <!-- agent：明确告知无需凭据 -->
    <div v-if="access === 'agent'" class="note">
      <b>Agent 回连模式</b>：不需要 kubeconfig，也不需要 kube-apiserver 地址。Runner 出站回连，hub 侧零凭据。只需在上方选择已注册且在线（心跳新鲜）的目标即可。
    </div>

    <!-- kubeconfig -->
    <div v-else-if="access === 'kubeconfig'">
      <div class="field">
        <label>凭据来源</label>
        <div class="seg">
          <button class="seg-btn" :class="{ active: kubeSource === 'ref' }" @click="setKubeSource('ref')">引用凭据</button>
          <button class="seg-btn" :class="{ active: kubeSource === 'paste' }" @click="setKubeSource('paste')">粘贴 kubeconfig</button>
          <button class="seg-btn" :class="{ active: kubeSource === 'manual' }" @click="setKubeSource('manual')">手工填写</button>
        </div>
      </div>

      <div v-if="kubeSource === 'ref'" class="field">
        <label>kubeconfig 凭据引用</label>
        <div class="kv-row">
          <select class="input" :value="draft.kubeCredRef || savedCredId" @change="patch({ kubeCredRef: ($event.target as HTMLSelectElement).value })">
            <option value="">— 未配置 —</option>
            <option v-for="c in kubeCreds" :key="c.id" :value="c.id">{{ c.name }}（{{ c.valueSet ? '已配置' : '空' }}）</option>
          </select>
        </div>
        <div class="hint" v-if="selectedCredName">已引用：{{ selectedCredName }}（仅记引用，凭据明文由 hub 持有）</div>
        <div class="hint" v-else>尚无凭据，可切到「粘贴」或「手工填写」。</div>
      </div>

      <div v-else-if="kubeSource === 'paste'" class="field">
        <label>粘贴 kubeconfig（YAML）</label>
        <textarea v-model="pasteRaw" class="input" placeholder="粘贴完整 kubeconfig 内容…" style="min-height: 120px"></textarea>
        <div class="kv-row">
          <button class="btn btn-pearl btn-sm" :disabled="parsing" @click="parseKube">{{ parsing ? '解析中…' : '解析并回显' }}</button>
          <button v-if="parseResult && !parseResult.errors.length" class="btn btn-pearl btn-sm" @click="savePastedAsCredential">保存为凭据</button>
        </div>
        <div v-if="parseResult" class="parse-card">
          <div class="pc-row"><span>apiserver</span><code class="mono">{{ parseResult.server || '—' }}</code></div>
          <div class="pc-row"><span>认证方式</span><code>{{ parseResult.authMethod }}</code></div>
          <div class="pc-row"><span>CA 证书</span><code>{{ parseResult.caPresent ? '有' : '无' }}</code></div>
          <div class="pc-row"><span>跳过 TLS 校验</span><code>{{ parseResult.insecureSkipTLS ? '是' : '否' }}</code></div>
          <div class="pc-row"><span>current-context</span><code>{{ parseResult.currentContext || '—' }}</code></div>
          <div class="pc-row"><span>默认命名空间</span><code>{{ parseResult.defaultNamespace || '—' }}</code></div>
          <div v-if="parseResult.errors.length" class="err-box">
            <div v-for="(er, i) in parseResult.errors" :key="i">{{ er }}</div>
          </div>
        </div>
        <div class="hint">解析完成后明文即被消费：保存为凭据后粘贴框清空，仅留结构摘要。</div>
      </div>

      <div v-else class="field">
        <label>apiserver 地址</label>
        <input class="input mono" :value="draft.kubeServer" placeholder="https://10.0.0.1:6443" @input="patch({ kubeServer: ($event.target as HTMLInputElement).value })" />
        <label class="check"><input type="checkbox" :checked="draft.kubeInsecureSkipTLS" @change="patch({ kubeInsecureSkipTLS: ($event.target as HTMLInputElement).checked })" /> 跳过 TLS 校验（insecure-skip-tls-verify）</label>
        <label>默认命名空间</label>
        <input class="input mono" :value="draft.kubeDefaultNS" @input="patch({ kubeDefaultNS: ($event.target as HTMLInputElement).value })" placeholder="默认 context 下的 namespace" />
      </div>
    </div>

    <!-- ssh -->
    <div v-else>
      <div class="field">
        <label>目标主机清单</label>
        <div v-for="(h, i) in hosts" :key="i" class="host-row">
          <input class="input" v-model="h.host" placeholder="host / IP" @input="syncHosts" />
          <input class="input port" type="number" v-model.number="h.port" placeholder="22" @input="syncHosts" />
          <input class="input" v-model="h.user" placeholder="user" @input="syncHosts" />
          <select class="select auth" v-model="h.authType" @change="syncHosts">
            <option value="key">key</option>
            <option value="password">password</option>
          </select>
          <button class="kv-del" @click="removeHost(i)">×</button>
        </div>
        <button class="link-btn" @click="addHost">＋ 添加主机</button>
      </div>
      <div class="field">
        <label>SSH 凭据引用</label>
        <select class="input" :value="draft.sshSecretRef" @change="patch({ sshSecretRef: ($event.target as HTMLSelectElement).value })">
          <option value="">— 未配置（可稍后）—</option>
          <option v-for="c in sshCreds" :key="c.id" :value="c.id">{{ c.name }}（{{ c.valueSet ? '已配置' : '空' }}）</option>
        </select>
      </div>
      <label class="check"><input type="checkbox" :checked="draft.sshSudo" @change="patch({ sshSudo: ($event.target as HTMLInputElement).checked })" /> 部署时用 sudo 提权（配合非 root 账号）</label>
    </div>
  </div>
</template>

<style scoped>
.note { background: var(--action-blue-soft); border-radius: 8px; padding: 10px 12px; font-size: 13px; color: var(--near-black); }
.seg { display: flex; gap: 6px; }
.seg-btn { flex: 1; padding: 8px 10px; border: 1px solid var(--hairline); background: var(--surface); border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--sub); }
.seg-btn.active { background: var(--action-blue-soft); border-color: var(--action-blue); color: var(--action-blue); }
.check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink); margin-top: 8px; font-weight: 500; }
.host-row { display: grid; grid-template-columns: 1.4fr 0.6fr 1fr 0.7fr auto; gap: 6px; margin-bottom: 6px; }
.host-row .port { min-width: 0; }
.host-row .auth { min-width: 0; }
.parse-card { background: var(--parchment); border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-top: 8px; }
.pc-row { display: flex; gap: 10px; padding: 2px 0; }
.pc-row span { width: 120px; color: var(--sub); flex: 0 0 120px; }
.hint { font-size: 12px; color: var(--sub); margin-top: 4px; }
</style>
