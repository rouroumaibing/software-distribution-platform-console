<script setup lang="ts">
// §7.12.3 环境详情 = 对接配置面板：基本信息 → 接入方式 → 凭据区 → 连接测试。
// 编辑走本地草稿 + 显式「保存配置」（PUT /environments/:id），关键字段变更由
// 后端回落状态机（§7.12.6）。连接测试走 POST /environments/:id/test。
import { reactive, ref, computed, watch, onMounted } from 'vue'
import Modal from '@/components/Modal.vue'
import { toast } from '@/utils/toast'
import {
  environmentApi,
  credentialApi,
  ENV_STATUS_META,
  ENV_ACCESS_LABEL,
  type Environment,
  type EnvironmentGroup,
  type EnvAccess,
  type EnvAccessConfig,
  type Credential,
  type TestReport,
} from '@/api/environment'
import type { Target } from '@/api/target'
import CredentialArea from './CredentialArea.vue'
import ConnectionTest from './ConnectionTest.vue'

const props = defineProps<{
  env: Environment
  targets: Target[]
  groups: EnvironmentGroup[]
  credentials: Credential[]
}>()

const emit = defineEmits<{
  saved: [env: Environment]
  deleted: [id: string]
  close: []
}>()

const draft = reactive<Environment>({ ...props.env, accessConfig: { ...(props.env.accessConfig || {}) } })

watch(
  () => props.env,
  (e) => {
    Object.assign(draft, e, { accessConfig: { ...(e.accessConfig || {}) } })
  },
  { deep: true },
)

const targetName = computed(() => props.targets.find((t) => t.id === draft.targetId)?.name ?? '—')
const statusMeta = computed(() => ENV_STATUS_META[draft.status])
const saving = ref(false)
const deleting = ref(false)
const confirmDelete = ref(false)

const credentials = ref<Credential[]>(props.credentials)
async function refreshCredentials() {
  try {
    const r = await credentialApi.list(undefined, undefined, { page: 1, pageSize: 200 })
    credentials.value = r.items
  } catch {
    credentials.value = props.credentials
  }
}
onMounted(refreshCredentials)

function onAccessChange(a: EnvAccess) {
  draft.access = a
  if (!draft.accessConfig) draft.accessConfig = {}
}

function onConfigUpdate(cfg: EnvAccessConfig) {
  draft.accessConfig = cfg
}

const testReport = ref<TestReport | null>(null)
const testing = ref(false)
async function runTest() {
  testing.value = true
  try {
    const r = await environmentApi.test(draft.id)
    testReport.value = r
    draft.status = r.status
    draft.lastTestAt = r.testedAt
    draft.lastTestResult = JSON.stringify(r)
    toast.ok('连接测试完成')
    emit('saved', { ...draft })
  } catch (e: any) {
    toast.err('连接测试失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    testing.value = false
  }
}

async function save() {
  if (!draft.name.trim() || !draft.namespace.trim()) {
    toast.err('名称与命名空间必填')
    return
  }
  if (draft.access === 'agent' && !draft.targetId) {
    toast.err('Agent 模式需选择接入目标')
    return
  }
  saving.value = true
  try {
    const updated = await environmentApi.update(draft.id, {
      name: draft.name,
      envType: draft.envType,
      groupId: draft.groupId || undefined,
      targetId: draft.targetId,
      namespace: draft.namespace,
      access: draft.access,
      accessConfig: draft.accessConfig,
    })
    toast.ok('配置已保存')
    emit('saved', updated)
  } catch (e: any) {
    toast.err('保存失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    saving.value = false
  }
}

async function doDelete() {
  deleting.value = true
  try {
    await environmentApi.remove(draft.id)
    toast.ok('环境已删除')
    emit('deleted', draft.id)
  } catch (e: any) {
    toast.err('删除失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    deleting.value = false
    confirmDelete.value = false
  }
}
</script>

<template>
  <section class="panel">
    <div class="phead">
      <div class="title-wrap">
        <h2>{{ draft.name }}</h2>
        <span class="badge" :style="{ background: statusMeta.dot + '22', color: statusMeta.dot }">
          <span class="pt" :style="{ background: statusMeta.dot }"></span>{{ statusMeta.label }}
        </span>
        <span class="badge" :class="draft.envType === 'production' ? 'b-fail' : 'b-pend'">{{ draft.envType }}</span>
      </div>
      <div class="pactions">
        <button class="link-btn" @click="emit('close')">← 返回</button>
        <button class="link-btn danger" @click="confirmDelete = true">删除</button>
      </div>
    </div>

    <!-- ① 基本信息 -->
    <div class="sec">
      <h3>基本信息</h3>
      <div class="two">
        <div class="field">
          <label>环境名称</label>
          <input v-model="draft.name" class="input" maxlength="128" />
        </div>
        <div class="field">
          <label>Key（英文标识）</label>
          <input v-model="draft.key" class="input mono" maxlength="64" />
        </div>
      </div>
      <div class="two">
        <div class="field">
          <label>环境类型</label>
          <select v-model="draft.envType" class="select">
            <option value="test">test（测试）</option>
            <option value="production">production（生产）</option>
          </select>
        </div>
        <div class="field">
          <label>所属分组</label>
          <select v-model="draft.groupId" class="select">
            <option value="">未分组</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
      </div>
      <div class="kv-grid">
        <div><span class="k">目标</span><span class="v mono">{{ targetName }}</span></div>
        <div><span class="k">命名空间</span><input v-model="draft.namespace" class="input mini mono" maxlength="128" /></div>
      </div>
    </div>

    <!-- ② 接入方式 -->
    <div class="sec">
      <h3>接入方式</h3>
      <div class="seg">
        <button
          v-for="a in (['agent', 'kubeconfig', 'ssh'] as EnvAccess[])"
          :key="a"
          class="seg-btn"
          :class="{ active: draft.access === a }"
          @click="onAccessChange(a)"
        >{{ ENV_ACCESS_LABEL[a] }}</button>
      </div>
      <p class="hint">三种方式互斥（一个环境一种主接入方式）。改动关键字段（目标 / 命名空间 / 凭据引用）保存后会回落为「已配置·未验证」并清空上次测试结果。</p>
    </div>

    <!-- ③ 凭据区 -->
    <div class="sec">
      <h3>凭据区</h3>
      <CredentialArea
        :access="draft.access"
        :config="draft.accessConfig || {}"
        :credentials="credentials"
        :env-id="draft.id"
        @update:config="onConfigUpdate"
      />
    </div>

    <!-- ④ 连接测试 -->
    <div class="sec">
      <h3>
        连接测试
        <button class="btn btn-primary btn-sm" :disabled="testing" @click="runTest">
          {{ testing ? '测试中…' : '▷ 运行连接测试' }}
        </button>
      </h3>
      <ConnectionTest :report="testReport" :running="testing" />
    </div>

    <div class="pfoot">
      <button class="btn btn-pearl" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存配置' }}
      </button>
    </div>

    <Modal :open="confirmDelete" title="删除环境" :width="420" @close="confirmDelete = false">
      <p>确认删除环境「{{ draft.name }}」？该操作不可撤销，且会移出所属分组。</p>
      <template #foot>
        <button class="btn btn-pearl" @click="confirmDelete = false">取消</button>
        <button class="btn btn-danger" :disabled="deleting" @click="doDelete">{{ deleting ? '删除中…' : '确认删除' }}</button>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.panel {
  flex: 1; background: var(--surface); border-radius: 0 var(--radius-card) var(--radius-card) 0;
  padding: 18px 22px; max-height: 72vh; overflow-y: auto;
}
.phead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.title-wrap { display: flex; align-items: center; gap: 10px; }
.title-wrap h2 { font-size: 20px; font-weight: 600; }
.pactions { display: flex; gap: 10px; }
.sec { border-top: 1px solid var(--sub-hairline); padding: 16px 0; }
.sec h3 { font-size: 15px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
.seg { display: flex; gap: 6px; }
.seg-btn { flex: 1; padding: 9px 10px; border: 1px solid var(--hairline); background: var(--surface); border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--sub); }
.seg-btn.active { background: var(--action-blue-soft); border-color: var(--action-blue); color: var(--action-blue); }
.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
.kv-grid > div { display: flex; align-items: center; gap: 8px; }
.kv-grid .k { color: var(--sub); font-size: 13px; width: 64px; flex: 0 0 64px; }
.kv-grid .v { font-size: 13px; }
.input.mini { width: auto; flex: 1; padding: 6px 10px; }
.hint { font-size: 12px; color: var(--sub); margin-top: 8px; }
.pfoot { display: flex; justify-content: flex-end; gap: 10px; padding-top: 12px; border-top: 1px solid var(--sub-hairline); }
.link-btn.danger { color: var(--failed-fg); }
</style>
