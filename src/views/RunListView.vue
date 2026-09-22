<script setup lang="ts">
// 运行历史：按流水线列出(后端无全局 runs 端点,用级联定位 pipeline)。
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ResourceCascade, { type CascadeSelection } from '@/components/ResourceCascade.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import { runApi, type PipelineRun } from '@/api/run'

const route = useRoute()
const router = useRouter()

const pipelineId = ref((route.params.id as string) || '')
const runs = ref<PipelineRun[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

onMounted(() => {
  if (pipelineId.value) loadRuns()
})

async function onSelect(sel: CascadeSelection) {
  if (!sel.pipeline) {
    runs.value = []
    total.value = 0
    return
  }
  pipelineId.value = sel.pipeline.id
  page.value = 1
  await loadRuns()
}

async function loadRuns() {
  if (!pipelineId.value) return
  loading.value = true
  try {
    const p = await runApi.listByPipeline(pipelineId.value, { page: page.value, pageSize })
    runs.value = p.items
    total.value = p.total
  } finally {
    loading.value = false
  }
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
      <h1 class="title">运行</h1>
      <div class="sub">流水线运行历史</div>
    </div>
    <div v-if="!route.params.id" class="toolbar">
      <ResourceCascade level="pipeline" @select="onSelect" />
    </div>

    <div class="card flush">
      <div v-if="!pipelineId" class="empty">选择一条流水线查看运行历史</div>
      <div v-else-if="loading" class="loading">加载中…</div>
      <div v-else-if="runs.length === 0" class="empty">暂无运行记录</div>
      <table v-else class="table">
        <thead>
          <tr><th>运行</th><th>目标</th><th>触发人</th><th>状态</th><th>耗时</th><th>开始时间</th><th></th></tr>
        </thead>
        <tbody>
          <tr
            v-for="r in runs"
            :key="r.id"
            style="cursor: pointer"
            @click="router.push(`/pipelines/${r.pipelineId}/runs/${r.id}`)"
          >
            <td class="mono">{{ r.crName || r.id.slice(0, 8) }}</td>
            <td class="mono">{{ r.targetId?.slice(0, 8) || '—' }}</td>
            <td>{{ r.triggeredBy || '—' }}</td>
            <td><StatusBadge :phase="r.phase" /></td>
            <td>{{ duration(r) }}</td>
            <td class="mono">{{ r.startTime ? new Date(r.startTime).toLocaleString('zh-CN', { hour12: false }) : '—' }}</td>
            <td><a>监控 →</a></td>
          </tr>
        </tbody>
      </table>
    </div>
    <PaginationBar :total="total" :page="page" :page-size="pageSize" @change="(p) => { page = p; loadRuns() }" />
  </div>
</template>
