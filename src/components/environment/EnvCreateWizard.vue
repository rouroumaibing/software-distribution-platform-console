<script setup lang="ts">
// §7.12.2 新建环境 = 两步向导
// Step1 基本信息：名称 / 所属分组 / 类型；Step2 接入配置：接入方式三选一 →
// 只渲染该方式的最小必填项。凭据细节允许创建后再补（不把向导做成凭据表单）。
import { reactive, ref, computed, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import { toast } from '@/utils/toast'
import {
  environmentApi,
  credentialApi,
  ENV_ACCESS_LABEL,
  type Environment,
  type EnvironmentGroup,
  type EnvAccess,
  type EnvType,
  type KubeParseResult,
} from '@/api/environment'
import type { Target } from '@/api/target'

const props = defineProps<{
  open: boolean
  componentId: string
  groups: EnvironmentGroup[]
  targets: Target[]
  defaultGroupId?: string
}>()

const emit = defineEmits<{ close: []; created: [env: Environment] }>()

const step = ref(1)
const creating = ref(false)

const base = reactive({
  key: '',
  name: '',
  envType: 'test' as EnvType,
  groupId: '' as string,
})

const access = ref<EnvAccess>('agent')
const namespace = ref('')
const targetId = ref('')
const kubeSource = ref<'ref' | 'paste' | 'manual'>('ref')
const kubeCredRef = ref('')
const kubeServer = ref('')
const kubeInsecureSkipTLS = ref(false)
const pasteRaw = ref('')
const parseResult = ref<KubeParseResult | null>(null)
const parsing = ref(false)
const savedCredId = ref('')

// SSH 主机清单（向导最小：首台主机）
const sshTargets = reactive<{ host: string; port: number; user: string; authType: 'password' | 'key'; secretRef: string; bastion: string }[]>([])
const sshSecretRef = ref('')

const groupOptions = computed(() =>
  [{ id: '', name: '未分组' }, ...props.groups].map((g) => ({ value: g.id, label: g.name })),
)

const credentials = ref<{ id: string; name: string; type: string }[]>([])

// 进入向导时重置并拉取凭据库（ref 选择用）
watch(
  () => props.open,
  async (v) => {
    if (!v) return
    step.value = 1
    base.key = ''
    base.name = ''
    base.envType = 'test'
    base.groupId = props.defaultGroupId ?? ''
    access.value = 'agent'
    namespace.value = ''
    targetId.value = props.targets[0]?.id ?? ''
    kubeSource.value = 'ref'
    kubeCredRef.value = ''
    kubeServer.value = ''
    kubeInsecureSkipTLS.value = false
    pasteRaw.value = ''
    parseResult.value = null
    savedCredId.value = ''
    sshTargets.splice(0)
    sshSecretRef.value = ''
    try {
      const r = await credentialApi.list(undefined, undefined, { page: 1, pageSize: 200 })
      credentials.value = r.items.map((c) => ({ id: c.id, name: c.name, type: c.type }))
    } catch {
      credentials.value = []
    }
  },
)

function suggestKey() {
  if (!base.key.trim() && base.name.trim()) {
    base.key = base.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  }
}

const kubeCreds = computed(() => credentials.value.filter((c) => c.type === 'kubeconfig'))
const sshCreds = computed(() => credentials.value.filter((c) => c.type === 'ssh-key' || c.type === 'ssh-password'))

function addHost() {
  sshTargets.push({ host: '', port: 22, user: '', authType: 'key', secretRef: '', bastion: '' })
}
function removeHost(i: number) {
  sshTargets.splice(i, 1)
}

async function parseKube() {
  if (!pasteRaw.value.trim()) {
    toast.err('请先粘贴 kubeconfig 内容')
    return
  }
  parsing.value = true
  try {
    parseResult.value = await credentialApi.parseKubeconfig(pasteRaw.value)
    if (parseResult.value.errors.length > 0) {
      toast.err('解析发现问题，请查看下方提示')
    } else {
      toast.ok('解析通过：已识别 apiserver 与认证方式')
    }
  } catch (e: any) {
    toast.err('解析失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    parsing.value = false
  }
}

async function savePastedAsCredential() {
  if (!parseResult.value || parseResult.value.errors.length) {
    toast.err('请先完成有效解析')
    return
  }
  try {
    const c = await credentialApi.create({
      name: `${base.name || 'kubeconfig'}-${Date.now()}`,
      type: 'kubeconfig',
      scope: 'environment',
      scopeId: '', // 创建环境后再回填
      value: pasteRaw.value,
    })
    savedCredId.value = c.id
    kubeCredRef.value = c.id
    kubeSource.value = 'ref'
    toast.ok('凭据已保存（明文不再留存，仅记引用）')
    pasteRaw.value = ''
  } catch (e: any) {
    toast.err('凭据保存失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  }
}

function buildPayload(): Record<string, unknown> {
  const ac: Record<string, unknown> = {}
  if (access.value === 'kubeconfig') {
    ac.kubeSource = kubeSource.value
    if (kubeSource.value === 'ref') ac.kubeCredRef = savedCredId.value || kubeCredRef.value
    if (kubeSource.value === 'manual') {
      ac.kubeServer = kubeServer.value
      ac.kubeInsecureSkipTLS = kubeInsecureSkipTLS.value
    }
  } else if (access.value === 'ssh') {
    ac.sshSecretRef = sshSecretRef.value
    ac.sshSudo = false
    ac.sshTargets = sshTargets.map((h) => ({ host: h.host, port: h.port, user: h.user, authType: h.authType, secretRef: h.secretRef, bastion: h.bastion }))
  }
  return {
    componentId: props.componentId,
    key: base.key.trim(),
    name: base.name.trim(),
    envType: base.envType,
    groupId: base.groupId || undefined,
    targetId: access.value === 'agent' ? targetId.value : undefined,
    namespace: namespace.value.trim(),
    access: access.value,
    accessConfig: ac,
  }
}

function validateStep1(): boolean {
  if (!base.name.trim()) {
    toast.err('请填写环境名称')
    return false
  }
  suggestKey()
  if (!base.key.trim()) {
    toast.err('请填写 Key（英文标识）')
    return false
  }
  return true
}

function validateStep2(): boolean {
  if (!namespace.value.trim()) {
    toast.err('命名空间必填')
    return false
  }
  if (!targetId.value) {
    toast.err('请选择接入目标（集群 / 主机）')
    return false
  }
  if (access.value === 'kubeconfig' && kubeSource.value === 'manual' && !kubeServer.value.trim()) {
    toast.err('请填写 apiserver 地址，或改用「引用凭据」')
    return false
  }
  if (access.value === 'kubeconfig' && kubeSource.value === 'ref' && !(savedCredId.value || kubeCredRef.value)) {
    toast.err('请选择一条 kubeconfig 凭据（或改用其他方式）')
    return false
  }
  if (access.value === 'ssh') {
    if (sshTargets.length === 0 || !sshTargets[0].host.trim() || !sshTargets[0].user.trim()) {
      toast.err('请至少填写一台主机的 host 与 user')
      return false
    }
  }
  return true
}

async function next() {
  if (!validateStep1()) return
  step.value = 2
}

async function create() {
  if (!validateStep2()) return
  creating.value = true
  try {
    const env = await environmentApi.create(buildPayload())
    toast.ok(`环境「${env.name}」已创建，可继续完善对接配置`)
    emit('created', env)
    emit('close')
  } catch (e: any) {
    toast.err('创建失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <Modal :open="open" title="新建环境（两步向导）" :width="600" @close="emit('close')">
    <div v-if="step === 1">
      <div class="field">
        <label>环境名称 *</label>
        <input v-model="base.name" class="input" placeholder="如：生产环境" maxlength="128" @blur="suggestKey" />
      </div>
      <div class="field">
        <label>Key *（英文标识，自动建议）</label>
        <input v-model="base.key" class="input mono" placeholder="如 prod" maxlength="64" />
      </div>
      <div class="field">
        <label>所属分组</label>
        <select v-model="base.groupId" class="select">
          <option v-for="g in groupOptions" :key="g.value" :value="g.value">{{ g.label }}</option>
        </select>
        <div class="hint">分组 ≠ 环境类型：分组只是归类（可折叠、可为空），与环境类型正交；审批策略只看环境类型。</div>
      </div>
      <div class="field">
        <label>环境类型</label>
        <select v-model="base.envType" class="select">
          <option value="test">test（测试）</option>
          <option value="production">production（生产）</option>
        </select>
      </div>
    </div>

    <div v-else>
      <div class="field">
        <label>接入方式 *</label>
        <div class="seg">
          <button
            v-for="a in (['agent', 'kubeconfig', 'ssh'] as EnvAccess[])"
            :key="a"
            class="seg-btn"
            :class="{ active: access === a }"
            @click="access = a"
          >{{ ENV_ACCESS_LABEL[a] }}</button>
        </div>
      </div>

      <!-- 目标（NOT NULL，所有接入方式都需要先选一个目标/集群/主机） -->
      <div class="field">
        <label>目标（集群 / 主机）*</label>
        <select v-model="targetId" class="select">
          <option v-for="t in targets" :key="t.id" :value="t.id">
            {{ t.name }}（{{ t.status === 'online' ? '在线' : '离线' }}）
          </option>
        </select>
        <div class="hint">环境始终锚定到一个目标；接入方式只决定 hub 如何够到它（Agent 回连 / kubeconfig 直连 / SSH 直连）。</div>
      </div>

      <!-- agent -->
      <template v-if="access === 'agent'">
        <div class="field">
          <label>命名空间 *</label>
          <input v-model="namespace" class="input mono" placeholder="如：user-center-prod" maxlength="128" />
          <div class="hint">Agent 模式不需要 kubeconfig，也不需要 kube-apiserver 地址：Runner 出站回连，hub 零凭据。</div>
        </div>
      </template>

      <!-- kubeconfig -->
      <template v-else-if="access === 'kubeconfig'">
        <div class="field">
          <label>凭据来源</label>
          <div class="seg">
            <button class="seg-btn" :class="{ active: kubeSource === 'ref' }" @click="kubeSource = 'ref'">引用凭据</button>
            <button class="seg-btn" :class="{ active: kubeSource === 'paste' }" @click="kubeSource = 'paste'">粘贴 kubeconfig</button>
            <button class="seg-btn" :class="{ active: kubeSource === 'manual' }" @click="kubeSource = 'manual'">手工填写</button>
          </div>
        </div>

        <div v-if="kubeSource === 'ref'" class="field">
          <label>选择 kubeconfig 凭据 *</label>
          <select v-model="kubeCredRef" class="select">
            <option value="">— 请选择 —</option>
            <option v-for="c in kubeCreds" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <div v-if="kubeCreds.length === 0" class="hint">暂无 kubeconfig 凭据，可改用「粘贴」或「手工填写」。</div>
        </div>

        <div v-else-if="kubeSource === 'paste'" class="field">
          <label>粘贴 kubeconfig（YAML）</label>
          <textarea v-model="pasteRaw" class="input" placeholder="粘贴完整 kubeconfig 内容…" style="min-height: 120px"></textarea>
          <div class="kv-row">
            <button class="btn btn-pearl btn-sm" :disabled="parsing" @click="parseKube">
              {{ parsing ? '解析中…' : '解析并回显' }}
            </button>
            <button v-if="parseResult && !parseResult.errors.length" class="btn btn-pearl btn-sm" @click="savePastedAsCredential">
              保存为凭据
            </button>
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
        </div>

        <div v-else class="field">
          <label>apiserver 地址 *</label>
          <input v-model="kubeServer" class="input mono" placeholder="https://10.0.0.1:6443" />
          <label class="check"><input type="checkbox" v-model="kubeInsecureSkipTLS" /> 跳过 TLS 校验（insecure-skip-tls-verify）</label>
        </div>

        <div class="field">
          <label>命名空间 *</label>
          <input v-model="namespace" class="input mono" placeholder="如：user-center-prod" maxlength="128" />
        </div>
      </template>

      <!-- ssh -->
      <template v-else>
        <div class="field">
          <label>目标主机（至少一台）</label>
          <div v-for="(h, i) in sshTargets" :key="i" class="host-row">
            <input v-model="h.host" class="input" placeholder="host / IP" />
            <input v-model.number="h.port" class="input port" type="number" placeholder="22" />
            <input v-model="h.user" class="input" placeholder="user" />
            <select v-model="h.authType" class="select auth">
              <option value="key">key</option>
              <option value="password">password</option>
            </select>
            <button class="kv-del" @click="removeHost(i)">×</button>
          </div>
          <button class="link-btn" @click="addHost">＋ 添加主机</button>
        </div>
        <div class="field">
          <label>SSH 凭据引用</label>
          <select v-model="sshSecretRef" class="select">
            <option value="">— 可选（可稍后配置）—</option>
            <option v-for="c in sshCreds" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>命名空间</label>
          <input v-model="namespace" class="input mono" placeholder="非容器目标可不填，或填部署根目录" maxlength="128" />
        </div>
      </template>
    </div>

    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">取消</button>
      <button v-if="step === 1" class="btn btn-primary" @click="next">下一步</button>
      <button v-else class="btn btn-pearl" @click="step = 1">上一步</button>
      <button v-if="step === 2" class="btn btn-primary" :disabled="creating" @click="create">
        {{ creating ? '创建中…' : '创建' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.seg { display: flex; gap: 6px; }
.seg-btn {
  flex: 1; padding: 9px 10px; border: 1px solid var(--hairline); background: var(--surface);
  border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--sub);
}
.seg-btn.active { background: var(--action-blue-soft); border-color: var(--action-blue); color: var(--action-blue); }
.check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink); margin-top: 8px; font-weight: 500; }
.host-row { display: grid; grid-template-columns: 1.4fr 0.6fr 1fr 0.7fr auto; gap: 6px; margin-bottom: 6px; }
.host-row .port { min-width: 0; }
.host-row .auth { min-width: 0; }
.parse-card {
  background: var(--parchment); border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-top: 8px;
}
.pc-row { display: flex; gap: 10px; padding: 2px 0; }
.pc-row span { width: 120px; color: var(--sub); flex: 0 0 120px; }
</style>
