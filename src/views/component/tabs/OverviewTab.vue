<script setup lang="ts">
// 组件概览 Tab：KPI + 最近运行 + 最新制品（原详情页无此 Tab，IA v2 新增）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import { pipelineApi, type Pipeline } from '@/api/pipeline'
import { runApi, type PipelineRun } from '@/api/run'
import { artifactApi, type Artifact } from '@/api/artifact'
import { environmentApi } from '@/api/environment'

const props = defineProps<{ componentId: string }>()
const router = useRouter()

const pipelines = ref<Pipeline[]>([])
const recentRuns = ref<(PipelineRun & { pipelineName?: string })[]>([])
const artifacts = ref<Artifact[]>([])
const envCount = ref(0)
const loading = ref(true)

onMounted(async () => {
  try {
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
.kpi { background: #fff; border: 1px solid var(--hairline); border-radius: var(--radius-card); padding: 14px 16px; }
.kpi .label { font-size: 12.5px; color: var(--sub); }
.kpi .num { font-size: 26px; font-weight: 700; margin-top: 4px; }
.ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
.sec-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 14px 0; font-weight: 600; }
.sec-head .more { font-size: 13px; font-weight: 400; }
</style>
