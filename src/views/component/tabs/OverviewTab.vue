<script setup lang="ts">
// 组件概览 Tab：KPI + 最近运行 + 最新制品（原详情页无此 Tab，IA v2 新增）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import { pipelineApi, type Pipeline } from '@/api/pipeline'
import { runApi, type PipelineRun } from '@/api/run'
import { artifactApi, type Artifact } from '@/api/artifact'
import { environmentApi } from '@/api/environment'
import { componentApi, dependencyApi, type Component, type ComponentDependency } from '@/api/component'
import { toast } from '@/utils/toast'

// ---- §6.1 服务树治理（生命周期 / 标签 / 依赖图） ---------------------------
const comp = ref<Component | null>(null)
const govTags = ref('')
const govLifecycle = ref<'active' | 'frozen' | 'deprecated'>('active')
const govSaving = ref(false)
const depsUp = ref<(ComponentDependency & { name?: string })[]>([])
const depsDown = ref<(ComponentDependency & { name?: string })[]>([])
const siblingOptions = ref<Component[]>([])
const newDependsOn = ref('')

async function loadGovernance() {
  try {
    comp.value = await componentApi.get(props.componentId)
    govTags.value = comp.value.tags ?? ''
    govLifecycle.value = comp.value.lifecycle ?? 'active'
    const [up, down] = await Promise.all([
      dependencyApi.list(props.componentId, 'upstream').catch(() => []),
      dependencyApi.list(props.componentId, 'downstream').catch(() => []),
    ])
    depsUp.value = up
    depsDown.value = down
    // 依赖选择器：同服务内的其他组件（v1 口径；跨服务依赖后续放开）
    if (comp.value?.serviceId) {
      const sibs = await componentApi.listByService(comp.value.serviceId, { page: 1, pageSize: 200 }).catch(() => ({ items: [] }))
      siblingOptions.value = sibs.items.filter((c) => c.id !== props.componentId)
    }
  } catch {
    /* 治理区失败不阻塞概览 */
  }
}

const depName = (id: string) => siblingOptions.value.find((c) => c.id === id)?.name ?? id.slice(0, 8)

async function saveGovernance() {
  govSaving.value = true
  try {
    await componentApi.update(props.componentId, {
      tags: govTags.value.trim(),
      lifecycle: govLifecycle.value,
    })
    toast.ok('治理信息已保存')
  } finally {
    govSaving.value = false
  }
}

async function addDependency() {
  if (!newDependsOn.value) return
  try {
    await dependencyApi.add(props.componentId, newDependsOn.value)
    newDependsOn.value = ''
    toast.ok('依赖已声明')
    await loadGovernance()
  } catch (e) {
    toast.err('依赖被拒绝：' + (e instanceof Error ? e.message : '已存在或成环'))
  }
}

async function removeDependency(dependsOnId: string) {
  try {
    await dependencyApi.remove(props.componentId, dependsOnId)
    await loadGovernance()
  } catch {
    toast.err('解除依赖失败')
  }
}

const LIFECYCLE_LABEL: Record<string, string> = {
  active: '活跃', frozen: '冻结', deprecated: '废弃',
}
// 展示当前生命周期徽标（治理卡标题旁）
const lifecycleLabel = () => (comp.value ? (LIFECYCLE_LABEL[comp.value.lifecycle ?? 'active'] ?? '活跃') : '')

const props = defineProps<{ componentId: string }>()
const router = useRouter()

const pipelines = ref<Pipeline[]>([])
const recentRuns = ref<(PipelineRun & { pipelineName?: string })[]>([])
const artifacts = ref<Artifact[]>([])
const envCount = ref(0)
const loading = ref(true)

onMounted(async () => {
  try {
    loadGovernance()
    const [pls, arts, envs] = await Promise.all([
      pipelineApi.listByComponent(props.componentId, { page: 1, pageSize: 100 }),
      artifactApi.listByComponent(props.componentId, { page: 1, pageSize: 5 }).catch(() => ({ items: [] })),
      environmentApi.listByComponent(props.componentId, { page: 1, pageSize: 100 }).catch(() => ({ items: [] })),
    ])
    pipelines.value = pls.items
    artifacts.value = arts.items
    envCount.value = envs.items.length

    const all: (PipelineRun & { pipelineName?: string })[] = []
    for (const pl of pls.items) {
      const rp = await runApi.listByPipeline(pl.id, { page: 1, pageSize: 5 }).catch(() => ({ items: [] }))
      for (const r of rp.items) all.push({ ...r, pipelineName: pl.name })
    }
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    recentRuns.value = all.slice(0, 8)
  } finally {
    loading.value = false
  }
})

const succRate = () => {
  if (recentRuns.value.length === 0) return '—'
  const s = recentRuns.value.filter((r) => r.phase === 'Succeeded').length
  return Math.round((s / recentRuns.value.length) * 100) + '%'
}
</script>

<template>
  <div>
    <div v-if="loading" class="loading">加载中…</div>
    <template v-else>
      <div class="ov-kpis">
        <div class="kpi"><div class="label">流水线</div><div class="num">{{ pipelines.length }}</div></div>
        <div class="kpi"><div class="label">环境</div><div class="num">{{ envCount }}</div></div>
        <div class="kpi"><div class="label">制品（最近）</div><div class="num">{{ artifacts.length }}</div></div>
        <div class="kpi"><div class="label">近期成功率</div><div class="num">{{ succRate() }}</div></div>
      </div>

      <!-- §6.1 服务树治理：生命周期 / 标签 / 依赖图 -->
      <div class="card gov-card">
        <div class="sec-head">治理（服务树）· 当前：{{ lifecycleLabel() }}</div>
        <div class="gov-row">
          <div class="field">
            <label>生命周期</label>
            <select v-model="govLifecycle" class="select">
              <option value="active">活跃（正常触发）</option>
              <option value="frozen">冻结（仅提示）</option>
              <option value="deprecated">废弃（禁新触发，保留历史）</option>
            </select>
          </div>
          <div class="field" style="flex: 1">
            <label>治理标签（逗号分隔）</label>
            <input v-model="govTags" class="input" placeholder="如 core,billing" />
          </div>
          <button class="btn btn-primary" style="align-self: flex-end" :disabled="govSaving" @click="saveGovernance">
            {{ govSaving ? '保存中…' : '保存' }}
          </button>
        </div>
        <div class="dep-cols">
          <div>
            <div class="dep-title">我依赖（{{ depsUp.length }}）</div>
            <div v-if="depsUp.length === 0" class="empty" style="padding: 6px 0">无</div>
            <div v-for="d in depsUp" :key="d.id" class="dep-row">
              <span>{{ depName(d.dependsOnId) }}</span>
              <button class="link-btn danger" @click="removeDependency(d.dependsOnId)">解除</button>
            </div>
            <div class="dep-add">
              <select v-model="newDependsOn" class="select">
                <option value="">＋ 声明依赖…</option>
                <option v-for="c in siblingOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <button class="btn btn-pearl btn-sm" :disabled="!newDependsOn" @click="addDependency">添加</button>
            </div>
          </div>
          <div>
            <div class="dep-title">被依赖（{{ depsDown.length }}）</div>
            <div v-if="depsDown.length === 0" class="empty" style="padding: 6px 0">无</div>
            <div v-for="d in depsDown" :key="d.id" class="dep-row">
              <span>{{ depName(d.componentId) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="ov-grid">
        <div class="card flush">
          <div class="sec-head">最近运行 <router-link class="more" :to="`/components/${componentId}/runs`">全部 →</router-link></div>
          <div v-if="recentRuns.length === 0" class="empty">暂无运行记录</div>
          <table v-else class="table">
            <thead><tr><th>状态</th><th>流水线</th><th>触发人</th><th>开始时间</th></tr></thead>
            <tbody>
              <tr v-for="r in recentRuns" :key="r.id" style="cursor: pointer"
                  @click="router.push(`/pipelines/${r.pipelineId}/runs/${r.id}`)">
                <td><StatusBadge :phase="r.phase" /></td>
                <td>{{ r.pipelineName }}</td>
                <td>{{ r.triggeredBy || '—' }}</td>
                <td class="mono">{{ r.startTime ? new Date(r.startTime).toLocaleString('zh-CN', { hour12: false }) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card flush">
          <div class="sec-head">最新制品 <router-link class="more" :to="`/components/${componentId}/artifacts`">全部 →</router-link></div>
          <div v-if="artifacts.length === 0" class="empty">暂无制品</div>
          <table v-else class="table">
            <thead><tr><th>版本</th><th>类型</th><th>Commit</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="a in artifacts" :key="a.id">
                <td class="mono"><b>{{ a.version }}</b></td>
                <td><span class="chip">{{ a.artifactType }}</span></td>
                <td class="mono">{{ a.commitSha?.slice(0, 7) || '—' }}</td>
                <td class="mono">{{ new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ov-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.kpi { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--radius-card); padding: 14px 16px; }
.kpi .label { font-size: 12.5px; color: var(--sub); }
.kpi .num { font-size: 26px; font-weight: 700; margin-top: 4px; }
.ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
.sec-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 14px 0; font-weight: 600; }
.sec-head .more { font-size: 13px; font-weight: 400; }
.gov-card { margin-top: 16px; padding-bottom: 14px; }
.gov-row { display: flex; gap: 14px; align-items: flex-start; padding: 10px 14px 0; }
.dep-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 12px 14px 0; }
.dep-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.dep-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 13px; }
.dep-add { display: flex; gap: 8px; margin-top: 8px; }
.danger { color: var(--danger-fg, #b00); }
</style>
