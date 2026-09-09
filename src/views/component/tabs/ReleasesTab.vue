<script setup lang="ts">
// 发布 Tab：该组件 release 类型流水线的运行（原 ReleaseListView 的组件内逻辑）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import { pipelineApi, type Pipeline } from '@/api/pipeline'
import { runApi, type PipelineRun } from '@/api/run'

const props = defineProps<{ componentId: string }>()
const router = useRouter()

const releases = ref<(PipelineRun & { pipelineName?: string })[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const pls = await pipelineApi.listByComponent(props.componentId, { page: 1, pageSize: 100 })
    for (const p of (pls.items as Pipeline[]).filter((x) => x.kind === 'release')) {
      const runs = await runApi.listByPipeline(p.id, { page: 1, pageSize: 20 }).catch(() => ({ items: [] }))
      for (const r of runs.items) releases.value.push({ ...r, pipelineName: p.name })
    }
    releases.value.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="card flush">
    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="releases.length === 0" class="empty">暂无发布记录（kind=release 的流水线运行）</div>
    <table v-else class="table">
      <thead><tr><th>发布</th><th>流水线</th><th>触发人</th><th>状态</th><th>开始时间</th><th></th></tr></thead>
      <tbody>
        <tr v-for="r in releases" :key="r.id" style="cursor: pointer"
            @click="router.push(`/releases/${r.id}?pipelineId=${r.pipelineId}`)">
          <td class="mono">{{ r.crName || r.id.slice(0, 8) }}</td>
          <td>{{ r.pipelineName }}</td>
          <td>{{ r.triggeredBy || '—' }}</td>
          <td><StatusBadge :phase="r.phase" /></td>
          <td class="mono">{{ r.startTime ? new Date(r.startTime).toLocaleString('zh-CN', { hour12: false }) : '—' }}</td>
          <td><a>灰度详情 →</a></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
