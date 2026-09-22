<script setup lang="ts">
// 日志 Tab：选择该组件的运行（/任务）查看日志（原 LogsView 逻辑，绑定组件上下文）。
import { computed, onMounted, ref } from 'vue'
import { runApi, type PipelineRun, type TaskRunLog, type TaskRun } from '@/api/run'
import { pipelineApi, type Pipeline } from '@/api/pipeline'

const props = defineProps<{ componentId: string }>()

const runs = ref<(PipelineRun & { pipelineName?: string; tasks?: TaskRun[] })[]>([])
const selectedRunId = ref('')
const selectedTask = ref('')
const logs = ref<TaskRunLog[]>([])
const loading = ref(true)
const logsLoading = ref(false)

const currentRun = computed(() => runs.value.find((r) => r.id === selectedRunId.value))

onMounted(async () => {
  try {
    const pls = await pipelineApi.listByComponent(props.componentId, { page: 1, pageSize: 100 })
    const all: (PipelineRun & { pipelineName?: string })[] = []
    for (const pl of (pls.items as Pipeline[])) {
      const rp = await runApi.listByPipeline(pl.id, { page: 1, pageSize: 10 }).catch(() => ({ items: [] }))
      for (const r of rp.items) all.push({ ...r, pipelineName: pl.name })
    }
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    runs.value = all.slice(0, 20)
    if (runs.value.length > 0) await selectRun(runs.value[0].id)
  } finally {
    loading.value = false
  }
})

async function selectRun(runId: string) {
  selectedRunId.value = runId
  selectedTask.value = ''
  const run = runs.value.find((r) => r.id === runId)
  if (run && !run.tasks) {
    run.tasks = await runApi.listTasks(runId).catch(() => [])
  }
  await loadLogs()
}

async function selectTask(t: string) {
  selectedTask.value = t
  await loadLogs()
}

async function loadLogs() {
  if (!selectedRunId.value) return
  logsLoading.value = true
  try {
    const data = await runApi.logs(selectedRunId.value, selectedTask.value || undefined, { page: 1, pageSize: 500 })
    logs.value = data.items
  } catch {
    logs.value = []
  } finally {
    logsLoading.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="runs.length === 0" class="empty">该组件暂无运行，无日志可看</div>
    <div v-else class="log-grid">
      <div class="card side">
        <div class="side-label">运行</div>
        <div class="run-list">
          <div v-for="r in runs" :key="r.id" class="run-item" :class="{ on: r.id === selectedRunId }"
               @click="selectRun(r.id)">
            <span class="mono">{{ r.crName || r.id.slice(0, 8) }}</span>
            <span class="sub">{{ r.pipelineName }}</span>
          </div>
        </div>
        <div v-if="currentRun?.tasks?.length" class="side-label" style="margin-top: 12px">任务</div>
        <div v-if="currentRun?.tasks?.length" class="run-list">
          <div class="run-item" :class="{ on: selectedTask === '' }" @click="selectTask('')">
            <span>运行级</span>
          </div>
          <div v-for="t in currentRun.tasks" :key="t.id" class="run-item" :class="{ on: selectedTask === t.taskName }"
               @click="selectTask(t.taskName)">
            <span>{{ t.taskName }}</span>
          </div>
        </div>
      </div>
      <div class="card main-log">
        <div class="log-head">
          <span class="sub mono">{{ selectedRunId.slice(0, 8) }}{{ selectedTask ? ' / ' + selectedTask : ' / 运行级' }}</span>
          <button class="btn btn-pearl btn-sm" :disabled="logsLoading" @click="loadLogs">刷新</button>
        </div>
        <pre v-if="logs.length" class="log-out">{{ logs.map((l) => l.chunk).join('') }}</pre>
        <div v-else-if="logsLoading" class="empty">加载中…</div>
        <div v-else class="empty">暂无日志</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-grid { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
.side-label { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.run-list { display: flex; flex-direction: column; gap: 4px; }
.run-item { padding: 8px 10px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.run-item:hover { background: var(--parchment); }
.run-item.on { background: var(--action-blue-soft); color: var(--action-blue); font-weight: 600; }
.log-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.log-out {
  margin: 0;
  padding: 12px;
  background: var(--term-bg);
  color: var(--term-fg);
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 60vh;
  overflow: auto;
}
</style>
