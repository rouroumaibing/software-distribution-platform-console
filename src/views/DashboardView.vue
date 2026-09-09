<script setup lang="ts">
// F2 总览：KPI + 异常 Runner 提示 + 最近运行(CONSOLE-LAYOUT §3.1)。
// 后端无全局 runs 端点,最近运行取第一个流水线的前 5 条。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import { clusterApi, type Cluster } from '@/api/cluster'
import { orgApi } from '@/api/org'
import { catalogApi } from '@/api/catalog'
import { componentApi } from '@/api/component'
import { pipelineApi } from '@/api/pipeline'
import { runApi, type PipelineRun } from '@/api/run'
import { environmentApi } from '@/api/environment'

const router = useRouter()
const clusters = ref<Cluster[]>([])
const recentRuns = ref<PipelineRun[]>([])
const pipelineNameMap = ref<Record<string, string>>({})
const runCount = ref(0)
const envCount = ref(0)
const loading = ref(true)

const onlineClusters = () => clusters.value.filter((c) => c.status === 'online').length

onMounted(async () => {
  try {
    const cp = await clusterApi.list({ page: 1, pageSize: 100 })
    clusters.value = cp.items

    // 沿 Org→Tree→Service→Component→Pipeline 取第一条流水线的最近运行做展示。
    const orgs = await orgApi.list({ page: 1, pageSize: 1 })
    if (orgs.items.length > 0) {
      const tree = await orgApi.getServiceTree(orgs.items[0].id)
      const services = await catalogApi.listByServiceTree(tree.id, { page: 1, pageSize: 20 })
      for (const s of services.items) {
        const comps = await componentApi.listByService(s.id, { page: 1, pageSize: 20 })
        for (const c of comps.items) {
          const envs = await environmentApi.listByComponent(c.id, { page: 1, pageSize: 100 })
          envCount.value += envs.total
          const pls = await pipelineApi.listByComponent(c.id, { page: 1, pageSize: 20 })
          for (const p of pls.items) {
            pipelineNameMap.value[p.id] = `${c.name} / ${p.name}`
            const runs = await runApi.listByPipeline(p.id, { page: 1, pageSize: 5 })
            runCount.value += runs.total
            for (const r of runs.items) recentRuns.value.push(r)
          }
        }
      }
      recentRuns.value.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      recentRuns.value = recentRuns.value.slice(0, 5)
    }
  } finally {
    loading.value = false
  }
})

function fmtTime(s?: string) {
  return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function duration(r: PipelineRun) {
  if (!r.startTime) return '—'
  const end = r.completionTime ? new Date(r.completionTime).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - new Date(r.startTime).getTime()) / 1000))
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1 class="title">总览</h1>
      <div class="sub">跨集群运行态势</div>
    </div>

    <div v-if="clusters.length > 0 && onlineClusters() < clusters.length" class="err-box">
      ⚠ {{ clusters.length - onlineClusters() }} 个集群离线，Runner 重连后将自动重放 Pending 任务。
    </div>

    <div class="kpi-grid">
      <div class="card kpi">
        <div class="label">流水线运行（累计）</div>
        <div class="num">{{ loading ? '…' : runCount }}</div>
      </div>
      <div class="card kpi">
        <div class="label">活跃环境</div>
        <div class="num">{{ loading ? '…' : envCount }}</div>
      </div>
      <div class="card kpi">
        <div class="label">注册集群</div>
        <div class="num">{{ clusters.length }}</div>
      </div>
      <div class="card kpi">
        <div class="label">在线集群</div>
        <div class="num" :style="{ color: onlineClusters() === clusters.length ? 'var(--succeeded-fg)' : 'var(--failed-fg)' }">
          {{ onlineClusters() }}
        </div>
      </div>
    </div>

    <h2 class="h2">最近运行</h2>
    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="recentRuns.length === 0" class="empty">暂无运行记录。到流水线页触发第一次运行。</div>
      <table v-else class="table">
        <thead>
          <tr><th>运行</th><th>流水线</th><th>触发人</th><th>状态</th><th>耗时</th><th>开始时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in recentRuns" :key="r.id" style="cursor: pointer" @click="router.push(`/pipelines/${r.pipelineId}/runs/${r.id}`)">
            <td class="mono">{{ r.crName || r.id.slice(0, 8) }}</td>
            <td>{{ pipelineNameMap[r.pipelineId] || r.pipelineId.slice(0, 8) }}</td>
            <td>{{ r.triggeredBy || '—' }}</td>
            <td><StatusBadge :phase="r.phase" /></td>
            <td>{{ duration(r) }}</td>
            <td class="mono">{{ fmtTime(r.startTime) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 18px; }
.kpi .label { font-size: 13px; color: var(--sub); }
.kpi .num { font-size: 32px; font-weight: 700; margin-top: 6px; }
</style>
