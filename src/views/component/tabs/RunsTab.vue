<script setup lang="ts">
// 运行 Tab：该组件全部流水线的运行（聚合，原详情页 runs 区块迁移）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import { pipelineApi, type Pipeline } from '@/api/pipeline'
import { runApi, type PipelineRun } from '@/api/run'

const props = defineProps<{ componentId: string }>()
const router = useRouter()

const runs = ref<(PipelineRun & { pipelineName?: string })[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const pls = await pipelineApi.listByComponent(props.componentId, { page: 1, pageSize: 100 })
    const all: (PipelineRun & { pipelineName?: string })[] = []
    for (const pl of (pls.items as Pipeline[])) {
      const rp = await runApi.listByPipeline(pl.id, { page: 1, pageSize: 10 }).catch(() => ({ items: [] }))
      for (const r of rp.items) all.push({ ...r, pipelineName: pl.name })
    }
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    runs.value = all.slice(0, 50)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="card flush">
    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="runs.length === 0" class="empty">暂无运行记录</div>
    <table v-else class="table">
      <thead><tr><th>运行</th><th>流水线</th><th>触发人</th><th>状态</th><th>开始时间</th></tr></thead>
      <tbody>
        <tr v-for="r in runs" :key="r.id" style="cursor: pointer"
            @click="router.push(`/pipelines/${r.pipelineId}/runs/${r.id}`)">
          <td class="mono">{{ r.crName || r.id.slice(0, 8) }}</td>
          <td>{{ r.pipelineName }}</td>
          <td>{{ r.triggeredBy || '—' }}</td>
          <td><StatusBadge :phase="r.phase" /></td>
          <td class="mono">{{ r.startTime ? new Date(r.startTime).toLocaleString('zh-CN', { hour12: false }) : '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
