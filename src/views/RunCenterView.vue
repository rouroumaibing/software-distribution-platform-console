<script setup lang="ts">
// 运行中心（IA v2）：全局跨组件运行巡视。
// 数据源 hub GET /api/v1/runs（全局端点），pipelineId → 组件/流水线名
// 由服务树索引（buildPipelineIndex）补齐。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import { runApi, type PipelineRun } from '@/api/run'
import { buildPipelineIndex, type PipelineRef } from '@/composables/useResourceMap'

const router = useRouter()

const runs = ref<PipelineRun[]>([])
const index = ref<Map<string, PipelineRef>>(new Map())
const total = ref(0)
const page = ref(1)
const pageSize = 20
const phase = ref('')
const loading = ref(true)

const filters = [
  { value: '', label: '全部' },
  { value: 'Failed', label: '失败' },
  { value: 'Running', label: '运行中' },
  { value: 'WaitingApproval', label: '待审批' },
  { value: 'Succeeded', label: '成功' },
]

onMounted(async () => {
  index.value = await buildPipelineIndex().catch(() => new Map())
  await load()
})

async function load() {
  loading.value = true
  try {
    const p = await runApi.listAll({ page: page.value, pageSize, phase: phase.value || undefined })
    runs.value = p.items
    total.value = p.total
  } finally {
    loading.value = false
  }
}

function setPhase(v: string) {
  phase.value = v
  page.value = 1
  load()
}

const ref_ = (r: PipelineRun) => index.value.get(r.pipelineId)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

function fmtDuration(r: PipelineRun) {
  if (!r.startTime) return '—'
  const end = r.completionTime ? new Date(r.completionTime).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - new Date(r.startTime).getTime()) / 1000))
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1 class="title">运行中心</h1>
      <div class="sub">跨组件全局运行巡视 · 点击行直达运行监控</div>
    </div>

    <div class="toolbar" style="margin-top: 0">
      <button
        v-for="f in filters"
        :key="f.value"
        class="btn btn-sm"
        :class="phase === f.value ? 'btn-dark' : 'btn-pearl'"
        @click="setPhase(f.value)"
      >{{ f.label }}</button>
      <div class="spacer"></div>
      <span class="sub">共 {{ total }} 条</span>
    </div>

    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="runs.length === 0" class="empty">暂无运行记录</div>
      <table v-else class="table">
        <thead><tr><th>状态</th><th>组件</th><th>流水线</th><th>触发人</th><th>开始时间</th><th>耗时</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id" style="cursor: pointer"
              @click="router.push(`/pipelines/${r.pipelineId}/runs/${r.id}`)">
            <td><StatusBadge :phase="r.phase" /></td>
            <td>
              <a v-if="ref_(r)" @click.stop="router.push(`/components/${ref_(r)!.componentId}/overview`)">{{ ref_(r)!.componentName }}</a>
              <span v-else class="mono">{{ r.pipelineId.slice(0, 8) }}</span>
            </td>
            <td>{{ ref_(r)?.pipelineName ?? r.pipelineId.slice(0, 8) }}</td>
            <td>{{ r.triggeredBy || '—' }}</td>
            <td class="mono">{{ r.startTime ? new Date(r.startTime).toLocaleString('zh-CN', { hour12: false }) : '—' }}</td>
            <td class="mono">{{ fmtDuration(r) }}</td>
            <td><a>监控 →</a></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pageCount > 1" class="toolbar">
      <button class="btn btn-pearl btn-sm" :disabled="page <= 1" @click="page--; load()">上一页</button>
      <span class="sub">{{ page }} / {{ pageCount }}</span>
      <button class="btn btn-pearl btn-sm" :disabled="page >= pageCount" @click="page++; load()">下一页</button>
    </div>
  </div>
</template>
