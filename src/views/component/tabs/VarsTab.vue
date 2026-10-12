<script setup lang="ts">
// 变量与密钥 Tab（ui-12 §5.3，N-26）：组件变量（明文 KV）/ 共享变量组（org 级
// + 绑定）/ 密钥（credentials，AES-GCM，永不回明文）。触发时解析顺序：
// 声明默认 < 变量组 < 组件变量 < 运行输入（hub triggerParams）。
import { computed, onMounted, ref } from 'vue'
import { componentApi, type ComponentConfig } from '@/api/component'
import { environmentApi, type Environment } from '@/api/environment'
import { credentialApi, type CredentialDTO } from '@/api/credential'
import { orgApi } from '@/api/org'
import {
  variableGroupApi,
  groupEntries,
  type VariableGroup,
  type VariableGroupBinding,
} from '@/api/variablegroup'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()

const configs = ref<ComponentConfig[]>([])
const envs = ref<Environment[]>([])
const secrets = ref<CredentialDTO[]>([])
const orgs = ref<Array<{ id: string; name: string }>>([])
const orgId = ref('')
const groups = ref<VariableGroup[]>([])
const bindings = ref<VariableGroupBinding[]>([])
const loading = ref(true)

const vars = computed(() => configs.value.filter((c) => !c.isSecret))
const secretConfigs = computed(() => configs.value.filter((c) => c.isSecret))

onMounted(async () => {
  try {
    const [cfg, envList] = await Promise.all([
      componentApi.listConfigs(props.componentId),
      environmentApi.listByComponent(props.componentId, { page: 1, pageSize: 100 }).catch(() => ({ items: [] as Environment[] })),
    ])
    configs.value = cfg?.items ?? (cfg as unknown as ComponentConfig[]) ?? []
    envs.value = envList.items ?? []
    const perEnv = await Promise.all(
      envs.value.map((e) =>
        credentialApi.list('environment' as never, e.id, { page: 1, pageSize: 100 } as never).catch(() => ({ items: [] as CredentialDTO[] })),
      ),
    )
    secrets.value = perEnv.flatMap((r) => (r as { items?: CredentialDTO[] }).items ?? [])
    try {
      const orgList = await orgApi.list({ page: 1, pageSize: 50 } as never)
      orgs.value = ((orgList as { items?: Array<{ id: string; name: string }> }).items ?? []).map((o) => ({ id: o.id, name: o.name }))
      if (orgs.value.length > 0) orgId.value = orgs.value[0].id
    } catch {
      /* org 不可见时变量组区降级为空态 */
    }
    await loadBindings()
    await loadGroups()
  } finally {
    loading.value = false
  }
})

async function loadBindings() {
  bindings.value = await variableGroupApi.listBindings(props.componentId).catch(() => [])
}

async function loadGroups() {
  if (!orgId.value) {
    groups.value = []
    return
  }
  groups.value = await variableGroupApi.listByOrg(orgId.value).catch(() => [])
}

const boundIds = computed(() => new Set(bindings.value.map((b) => b.groupId)))
const bindingOf = (gid: string) => bindings.value.find((b) => b.groupId === gid)

async function bind(g: VariableGroup) {
  try {
    await variableGroupApi.bind(props.componentId, g.id)
    toast.ok(`已绑定变量组「${g.name}」`)
    await loadBindings()
  } catch (e: any) {
    toast.err('绑定失败：' + (e?.response?.data?.error ?? e?.message ?? ''))
  }
}

async function unbind(g: VariableGroup) {
  const b = bindingOf(g.id)
  if (!b) return
  try {
    await variableGroupApi.unbind(b.id)
    toast.ok(`已解绑变量组「${g.name}」`)
    await loadBindings()
  } catch (e: any) {
    toast.err('解绑失败：' + (e?.response?.data?.error ?? e?.message ?? ''))
  }
}

const envName = (id?: string) => envs.value.find((e) => e.id === id)?.name ?? (id ? id.slice(0, 8) : '—')
</script>

<template>
  <div>
    <div v-if="loading" class="loading">加载中…</div>
    <template v-else>
      <!-- ① 组件变量 -->
      <h2 class="h2">组件变量</h2>
      <div class="sub" style="margin-bottom: 8px">
        明文 KV（配置 Tab 维护，此处只读视图）；触发时注入任务参数，运行输入可覆盖。
      </div>
      <div class="card flush">
        <div v-if="vars.length === 0" class="empty">暂无明文变量。在「配置」Tab 新增非保密参数后在此显示。</div>
        <table v-else class="table">
          <thead><tr><th>Key</th><th>值</th><th>环境</th><th>描述</th></tr></thead>
          <tbody>
            <tr v-for="v in vars" :key="v.id">
              <td class="mono"><b>{{ v.key }}</b></td>
              <td class="mono">{{ v.value ?? '—' }}</td>
              <td>{{ envName(v.environmentId) }}</td>
              <td class="sub">{{ v.description || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ② 变量组 -->
      <h2 class="h2">共享变量组</h2>
      <div class="sub" style="margin-bottom: 8px">
        org 级共享变量，多组件复用；优先级低于组件变量。解析顺序：声明默认 &lt; 变量组 &lt; 组件变量 &lt; 运行输入。
      </div>
      <div class="toolbar" style="margin-bottom: 10px">
        <select v-model="orgId" class="select" style="width: auto" @change="loadGroups">
          <option v-for="o in orgs" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <span class="sub">该 org 下 {{ groups.length }} 个变量组 · 本组件已绑定 {{ bindings.length }} 个</span>
      </div>
      <div class="card flush">
        <div v-if="groups.length === 0" class="empty">该 org 暂无变量组（管理端经 API 创建：POST /variable-groups）。</div>
        <table v-else class="table">
          <thead><tr><th>变量组</th><th>变量</th><th>状态</th><th></th></tr></thead>
          <tbody>
            <tr v-for="g in groups" :key="g.id">
              <td><b>{{ g.name }}</b><div class="sub">{{ g.description || '—' }}</div></td>
              <td class="mono sub">{{ groupEntries(g).map((e) => e.key).join('、') || '—' }}</td>
              <td>
                <span v-if="boundIds.has(g.id)" class="chip">已绑定 · 优先级 {{ bindingOf(g.id)?.priority }}</span>
                <span v-else class="sub">未绑定</span>
              </td>
              <td style="white-space: nowrap">
                <a v-if="!boundIds.has(g.id)" @click="bind(g)">绑定</a>
                <a v-else style="color: var(--failed-fg)" @click="unbind(g)">解绑</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ③ 密钥 -->
      <h2 class="h2">密钥（AES-GCM 信封加密）</h2>
      <div class="sub" style="margin-bottom: 8px">
        组件各环境绑定的凭据汇总；hub 永不回明文，只显示「已设置」状态与引用名。密钥经
        <b>平台管理 → 凭据管理</b> 创建轮转。
      </div>
      <div class="card flush">
        <div v-if="secrets.length === 0 && secretConfigs.length === 0" class="empty">该组件的环境暂无绑定凭据。</div>
        <table v-else class="table">
          <thead><tr><th>名称</th><th>类型</th><th>来源</th><th>值</th></tr></thead>
          <tbody>
            <tr v-for="s in secrets" :key="s.id">
              <td class="mono"><b>{{ s.name }}</b></td>
              <td>{{ s.type }}</td>
              <td class="sub">凭据库（{{ s.scope === 'environment' ? envName(s.scopeId) : s.scope }}）</td>
              <td><span class="chip">已设置（不回明文）</span></td>
            </tr>
            <tr v-for="c in secretConfigs" :key="c.id">
              <td class="mono"><b>{{ c.key }}</b></td>
              <td>secret</td>
              <td class="sub">组件配置（{{ envName(c.environmentId) }}）</td>
              <td>
                <span v-if="c.secretRef" class="chip mono">{{ c.secretRef }}</span>
                <span v-else class="chip">已设置（不回明文）</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
