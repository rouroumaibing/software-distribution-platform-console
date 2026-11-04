<script setup lang="ts">
// 集群权限（ACCESS-CONTROL §7 / §8）：K8s RBAC 授权层管理页。
// 列出环境上的集群角色绑定，支持创建（User 主体签发 kubeconfig）、
// 吊销（换 subject = 轮换 kubeconfig）、删除（清 CRB/Role + 台账）。
// 挂 /admin/cluster-permissions，L1 platform-admin 守卫。
import { computed, onMounted, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { type Environment } from '@/api/environment'
import { listPaged } from '@/api/crud'
import {
  clusterPermissionApi,
  type ClusterBinding,
  type ClusterRoleName,
  type ClusterSubjectKind,
  type CreateClusterPermissionInput,
} from '@/api/clusterPermission'
import { toast } from '@/utils/toast'

const bindings = ref<ClusterBinding[]>([])
const loading = ref(false)
const environments = ref<Environment[]>([])

const ROLE_OPTIONS: ClusterRoleName[] = ['admin', 'ops', 'dev', 'readonly', 'custom']
const SUBJECT_KIND_OPTIONS: ClusterSubjectKind[] = ['user', 'group', 'org']

const showCreate = ref(false)
const form = ref<CreateClusterPermissionInput>({
  environmentId: '',
  subjectKind: 'user',
  subjectId: '',
  subjectName: '',
  role: 'readonly',
  clusterScoped: false,
  namespace: '',
  resources: [],
  operations: [],
})
const issuing = ref(false)
const issuedKubeconfig = ref('')

async function load() {
  loading.value = true
  try {
    const [bs, envs] = await Promise.all([
      clusterPermissionApi.list().catch(() => [] as ClusterBinding[]),
      listPaged<Environment>('/environments').catch(() => ({ items: [] as Environment[] })),
    ])
    bindings.value = bs.map((x) => ({ ...x }))
    environments.value = envs.items ?? []
  } finally {
    loading.value = false
  }
}

onMounted(load)

const envName = (id: string) => environments.value.find((e) => e.id === id)?.name ?? id.slice(0, 8)

const canSubmit = computed(
  () =>
    !!form.value.environmentId &&
    !!form.value.subjectId &&
    (form.value.clusterScoped || !!form.value.namespace) &&
    (form.value.role !== 'custom' || (form.value.resources?.length && form.value.operations?.length)),
)

async function submitCreate() {
  if (!canSubmit.value) return
  issuing.value = true
  issuedKubeconfig.value = ''
  try {
    const res = await clusterPermissionApi.create({ ...form.value })
    toast.ok('集群权限已创建')
    showCreate.value = false
    if (res.kubeconfig) {
      issuedKubeconfig.value = res.kubeconfig
    }
    await load()
  } catch (e: unknown) {
    toast.err((e as Error)?.message ?? '创建失败')
  } finally {
    issuing.value = false
  }
}

async function revoke(b: ClusterBinding) {
  if (!confirm(`吊销 ${b.subjectName} 的集群权限？User 主体将轮换 kubeconfig（旧凭据失效）。`)) return
  try {
    const res = await clusterPermissionApi.revoke(b.id)
    toast.ok('已吊销')
    if (res.kubeconfig) {
      issuedKubeconfig.value = res.kubeconfig
    }
    await load()
  } catch (e: unknown) {
    toast.err((e as Error)?.message ?? '吊销失败')
  }
}

async function remove(b: ClusterBinding) {
  if (!confirm(`删除 ${b.subjectName} 的集群权限台账？将清理集群内 CRB/Role。`)) return
  try {
    await clusterPermissionApi.remove(b.id)
    toast.ok('已删除')
    await load()
  } catch (e: unknown) {
    toast.err((e as Error)?.message ?? '删除失败')
  }
}

function copyKubeconfig() {
  if (!issuedKubeconfig.value) return
  navigator.clipboard?.writeText(issuedKubeconfig.value).then(
    () => toast.ok('kubeconfig 已复制'),
    () => toast.err('复制失败'),
  )
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>集群权限</h1>
      <p class="muted">K8s RBAC 授权层：环境集群上的角色绑定 + User 主体 kubeconfig 签发/吊销。</p>
      <button class="btn primary" @click="showCreate = true">新建集群权限</button>
    </header>

    <div v-if="issuedKubeconfig" class="kc-box">
      <div class="kc-head">
        <strong>已签发 kubeconfig</strong>
        <button class="btn small" @click="copyKubeconfig">复制</button>
        <button class="btn small" @click="issuedKubeconfig = ''">关闭</button>
      </div>
      <pre>{{ issuedKubeconfig }}</pre>
      <p class="muted small">仅本次返回明文，请妥善保存；吊销后将轮换 subject 使旧凭据失效。</p>
    </div>

    <table class="tbl">
      <thead>
        <tr>
          <th>环境</th>
          <th>主体</th>
          <th>类型</th>
          <th>角色</th>
          <th>范围</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading && !bindings.length"><td colspan="7" class="muted center">加载中…</td></tr>
        <tr v-else-if="!bindings.length"><td colspan="7" class="muted center">暂无集群权限</td></tr>
        <tr v-for="b in bindings" :key="b.id">
          <td>{{ envName(b.environmentId) }}</td>
          <td>{{ b.subjectName }}</td>
          <td>{{ b.subjectKind }}</td>
          <td>{{ b.role }}</td>
          <td>{{ b.clusterScoped ? '集群级' : b.namespace }}</td>
          <td>{{ b.status }}</td>
          <td class="actions">
            <button class="btn small" @click="revoke(b)" :disabled="b.status === 'revoked'">吊销</button>
            <button class="btn small danger" @click="remove(b)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <Modal :open="showCreate" title="新建集群权限" @close="showCreate = false">
      <form class="form" @submit.prevent="submitCreate">
        <label>
          <span>环境</span>
          <select v-model="form.environmentId" required>
            <option value="" disabled>选择环境…</option>
            <option v-for="e in environments" :key="e.id" :value="e.id">{{ e.name }} ({{ e.namespace }})</option>
          </select>
        </label>
        <label>
          <span>主体类型</span>
          <select v-model="form.subjectKind">
            <option v-for="k in SUBJECT_KIND_OPTIONS" :key="k" :value="k">{{ k }}</option>
          </select>
        </label>
        <label>
          <span>主体 ID（hub sub / 组路径）</span>
          <input v-model="form.subjectId" placeholder="user sub 或 group path" required />
        </label>
        <label>
          <span>主体名称</span>
          <input v-model="form.subjectName" placeholder="显示名" required />
        </label>
        <label>
          <span>角色</span>
          <select v-model="form.role">
            <option v-for="r in ROLE_OPTIONS" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="row">
          <input type="checkbox" v-model="form.clusterScoped" />
          <span>集群级（ClusterRoleBinding）</span>
        </label>
        <label v-if="!form.clusterScoped">
          <span>命名空间</span>
          <input v-model="form.namespace" placeholder="namespace" required />
        </label>
        <label v-if="form.role === 'custom'">
          <span>资源（逗号分隔）</span>
          <input
            :value="form.resources?.join(',')"
            @input="(e) => (form.resources = (e.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean))"
            placeholder="pods,deployments"
          />
        </label>
        <label v-if="form.role === 'custom'">
          <span>操作（逗号分隔）</span>
          <input
            :value="form.operations?.join(',')"
            @input="(e) => (form.operations = (e.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean))"
            placeholder="get,list,create"
          />
        </label>
        <div class="form-actions">
          <button type="button" class="btn" @click="showCreate = false">取消</button>
          <button type="submit" class="btn primary" :disabled="!canSubmit || issuing">{{ issuing ? '签发中…' : '创建' }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.page { padding: 24px; }
.page-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; }
.page-head h1 { margin: 0; font-size: 20px; }
.page-head .muted { flex: 1; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th, .tbl td { padding: 8px 10px; border-bottom: 1px solid var(--border, #e5e7eb); text-align: left; font-size: 13px; }
.tbl th { color: var(--text-muted, #6b7280); font-weight: 600; }
.actions { display: flex; gap: 6px; }
.muted { color: var(--text-muted, #6b7280); }
.center { text-align: center; }
.small { font-size: 12px; }
.kc-box { margin-bottom: 16px; padding: 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: var(--bg-alt, #f9fafb); }
.kc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.kc-box pre { white-space: pre-wrap; word-break: break-all; max-height: 240px; overflow: auto; font-size: 12px; }
.form { display: flex; flex-direction: column; gap: 12px; min-width: 320px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.form label.row { flex-direction: row; align-items: center; gap: 6px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
