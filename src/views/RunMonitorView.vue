<script setup lang="ts">
// 运行监控(CONSOLE-LAYOUT §3.5)：DAG 横向流 + 选中任务详情 + 审批决策 + 日志面板预留。
// Running 时 3s 轮询 /runs/:id/progress;失败/卡住可 redispatch。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Modal from '@/components/Modal.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { runApi, type PipelineRun, type TaskRun, type TaskRunLog } from '@/api/run'
import { toast } from '@/utils/toast'

const route = useRoute()
const pipelineId = route.params.pipelineId as string
const runId = route.params.runId as string

const run = ref<PipelineRun>()
const tasks = ref<TaskRun[]>([])
const selected = ref<TaskRun>()
const loading = ref(true)

// 日志面板(G2 后端端点):按选中任务拉取流式子日志,运行活跃时随轮询刷新。
const logs = ref<TaskRunLog[]>([])
const logKey = ref('') // 当前已加载日志的 (run, task) 标识,避免重复拉取
const logLoading = ref(false)

// 审批弹窗
const approvalModal = ref(false)
const approvalReason = ref('')
const approving = ref(false)

let timer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  await refresh()
  loading.value = false
  timer = setInterval(async () => {
    if (run.value && ['Running', 'Pending', 'WaitingApproval'].includes(run.value.phase)) {
      await pollProgress()
    }
  }, 3000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function refresh() {
  run.value = await runApi.get(runId)
  tasks.value = await runApi.listTasks(runId)
  if (!selected.value && tasks.value.length > 0) {
    selected.value = tasks.value.find((t) => t.phase === 'Running') ?? tasks.value[0]
  }
  await loadLogs()
}

// 拉取当前运行/选中任务的日志。run 级用 __run__ 桶,选中具体任务用其 taskName。
async function loadLogs() {
  if (!run.value) return
  const taskName = selected.value?.taskName ?? '__run__'
  const key = `${runId}::${taskName}`
  // 运行已结束且已加载过该 (run, task) 的日志则不再重复拉取。
  if (key === logKey.value && !isActive.value) return
  logLoading.value = true
  try {
    const data = await runApi.logs(runId, taskName === '__run__' ? undefined : taskName, {
      page: 1,
      pageSize: 500,
    })
    logs.value = data.items
    logKey.value = key
  } catch {
    // 端点未就绪或运行无日志时静默,页面显示占位
  } finally {
    logLoading.value = false
  }
}

async function pollProgress() {
  try {
    const p = await runApi.progress(runId)
    if (run.value) run.value.phase = p.phase
    tasks.value = p.tasks
    if (selected.value) {
      selected.value = p.tasks.find((t) => t.taskName === selected.value?.taskName) ?? selected.value
    }
    // 运行活跃时同步刷新日志流。
    if (isActive.value) await loadLogs()
  } catch {
    // 轮询失败静默,下个周期重试
  }
}

// 切换选中任务时重新加载对应日志。
watch(selected, () => {
  if (selected.value) loadLogs()
})

const isActive = computed(() => run.value && ['Running', 'Pending'].includes(run.value.phase))
const waitingApproval = computed(() => run.value?.phase === 'WaitingApproval')

function nodeClass(t: TaskRun): string {
  switch (t.phase) {
    case 'Succeeded':
      return 'succ'
    case 'Running':
      return 'run'
    case 'Failed':
      return 'fail'
    default:
      return 'pend'
  }
}

function typeIcon(t: TaskRun): string {
  return t.type === 'Build' ? '⌘' : t.type === 'Release' ? '⬇' : '✓'
}

// 按 stage 分组保序展示(stageName 相同的连续任务在同一列)。
const stageGroups = computed(() => {
  const groups: { stage: string; tasks: TaskRun[] }[] = []
  for (const t of tasks.value) {
    const last = groups[groups.length - 1]
    if (last && last.stage === t.stageName) last.tasks.push(t)
    else groups.push({ stage: t.stageName || '任务', tasks: [t] })
  }
  return groups
})

async function redispatch() {
  await runApi.redispatch(runId)
  toast.ok('已重新投递')
  await refresh()
}

function openApproval(t: TaskRun) {
  selected.value = t
  approvalReason.value = ''
  approvalModal.value = true
}

async function decide(approved: boolean) {
  if (!selected.value) return
  approving.value = true
  try {
    await runApi.approve(pipelineId, runId, selected.value.taskName, {
      approved,
      reason: approvalReason.value || undefined,
    })
    toast.ok(approved ? '已批准' : '已拒绝')
    approvalModal.value = false
    await refresh()
  } catch (e: any) {
    toast.err('提交失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    approving.value = false
  }
}

function fmtTime(s?: string) {
  return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function duration(t: TaskRun) {
  if (!t.startTime) return '—'
  const end = t.completionTime ? new Date(t.completionTime).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - new Date(t.startTime).getTime()) / 1000))
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}
</script>

<template>
  <div>
    <div v-if="loading" class="loading">加载中…</div>
    <template v-else-if="run">
      <div class="page-head">
        <div class="crumb">运行 / <b>{{ run.crName || run.id.slice(0, 8) }}</b></div>
        <h1 class="title">{{ run.crName || 'PipelineRun' }}</h1>
        <div style="margin-top: 8px; display: flex; gap: 14px; align-items: center">
          <StatusBadge :phase="run.phase" />
          <span class="sub">触发人 {{ run.triggeredBy || '—' }} · 开始 {{ fmtTime(run.startTime) }}</span>
          <span v-if="isActive" class="sub">● 每 3s 自动刷新</span>
          <div class="spacer" style="flex: 1"></div>
          <button v-if="run.phase === 'Failed' || run.message" class="btn btn-pearl btn-sm" @click="redispatch">↻ 重新投递</button>
        </div>
        <div v-if="run.message" class="err-box" style="margin-top: 10px">{{ run.message }}</div>
      </div>

      <!-- DAG 横向流 -->
      <h2 class="h2">DAG 执行图</h2>
      <div class="card">
        <div class="legend">
          <span><i class="dot succ"></i>成功</span>
          <span><i class="dot run"></i>运行中</span>
          <span><i class="dot pend"></i>待执行</span>
          <span><i class="dot fail"></i>失败</span>
        </div>
        <div class="dag">
          <template v-for="(g, gi) in stageGroups" :key="gi">
            <div class="stage-col">
              <div class="stage-label">{{ g.stage }}</div>
              <div
                v-for="t in g.tasks"
                :key="t.id"
                class="node"
                :class="[nodeClass(t), { sel: selected?.id === t.id }]"
                @click="selected = t"
              >
                <div class="nname"><span class="nico">{{ typeIcon(t) }}</span>{{ t.taskName }}</div>
                <div class="nstatus"><StatusBadge :phase="t.phase" /></div>
              </div>
            </div>
            <div v-if="gi < stageGroups.length - 1" class="arrow" :class="{ done: g.tasks.every((t) => t.phase === 'Succeeded') }">→</div>
          </template>
        </div>
      </div>

      <!-- 选中任务详情 + 日志面板 -->
      <h2 class="h2">任务详情</h2>
      <div class="detail-grid">
        <div class="card">
          <template v-if="selected">
            <div style="display: flex; justify-content: space-between; align-items: center">
              <b>{{ selected.taskName }}</b>
              <StatusBadge :phase="selected.phase" />
            </div>
            <div class="kv-list">
              <div class="row"><span>类型</span><span><span class="chip">{{ selected.type }}</span></span></div>
              <div class="row"><span>阶段</span><span>{{ selected.stageName }}</span></div>
              <div class="row"><span>耗时</span><span>{{ duration(selected) }}</span></div>
              <div class="row"><span>重试次数</span><span>{{ selected.retryCount }}</span></div>
              <div class="row">
                <span>退出码</span>
                <span class="mono" :style="{ color: selected.exitCode === 0 ? 'var(--succeeded-fg)' : selected.exitCode ? 'var(--failed-fg)' : 'inherit' }">
                  {{ selected.exitCode ?? '—' }}
                </span>
              </div>
              <div class="row"><span>开始</span><span class="mono">{{ fmtTime(selected.startTime) }}</span></div>
              <div class="row"><span>结束</span><span class="mono">{{ fmtTime(selected.completionTime) }}</span></div>
            </div>
            <div v-if="selected.message" class="err-box">{{ selected.message }}</div>
            <div v-if="selected.type === 'Approval' && (waitingApproval || selected.phase === 'Running')" class="toolbar">
              <button class="btn btn-primary btn-sm" @click="openApproval(selected)">审批决策</button>
            </div>
          </template>
          <div v-else class="empty">点击 DAG 节点查看详情</div>
        </div>

        <div class="card log-panel">
          <div class="log-head">
            <b>日志</b>
            <span class="sub mono">{{ selected ? selected.taskName : '运行级' }}</span>
            <button class="btn btn-pearl btn-sm" :disabled="logLoading" @click="loadLogs">刷新</button>
          </div>
          <pre v-if="logs.length" class="log-out">{{ logs.map((l) => l.chunk).join('') }}</pre>
          <div v-else-if="logLoading" class="empty">加载中…</div>
          <div v-else class="empty">
            {{ isActive ? '任务运行中，日志流实时回传中…' : '暂无日志' }}
          </div>
        </div>
      </div>
    </template>

    <!-- 审批弹窗 -->
    <Modal :open="approvalModal" :title="`审批 · ${selected?.taskName ?? ''}`" @close="approvalModal = false">
      <div class="field">
        <label>审批意见</label>
        <textarea v-model="approvalReason" class="input" placeholder="可选"></textarea>
      </div>
      <template #foot>
        <button class="btn btn-danger" :disabled="approving" @click="decide(false)">拒绝</button>
        <button class="btn btn-primary" :disabled="approving" @click="decide(true)">✓ 批准</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--sub); margin-bottom: 14px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.dot.succ { background: var(--succeeded-fg); }
.dot.run { background: var(--running-fg); }
.dot.pend { background: var(--pending-fg); }
.dot.fail { background: var(--failed-fg); }
.dag { display: flex; align-items: flex-start; overflow-x: auto; padding-bottom: 4px; }
.stage-col { flex: 0 0 190px; }
.stage-label { font-size: 12px; color: var(--sub); font-weight: 600; margin-bottom: 8px; }
.node {
  border-radius: 10px; padding: 12px; background: #fff; cursor: pointer;
  border: 1.5px solid var(--hairline); margin-bottom: 8px; transition: 0.15s;
}
.node.sel { box-shadow: 0 0 0 3px var(--action-blue-soft); }
.node.succ { border-color: var(--succeeded-fg); }
.node.run { border: 2px solid var(--action-blue); }
.node.pend { border: 1px dashed var(--pending-fg); }
.node.fail { border-color: var(--failed-fg); }
.nname { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.nico { font-size: 12px; }
.arrow {
  flex: 0 0 36px; display: flex; align-items: center; justify-content: center;
  color: var(--sub); font-size: 18px; padding-top: 60px;
}
.arrow.done { color: var(--succeeded-fg); }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.kv-list { margin-top: 12px; }
.kv-list .row {
  display: flex; justify-content: space-between; gap: 16px;
  padding: 8px 0; border-bottom: 1px solid var(--sub-hairline); font-size: 13px;
}
.kv-list .row span:first-child { color: var(--sub); }
.log-panel { min-height: 220px; }
.log-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.log-out {
  margin: 0;
  padding: 12px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 360px;
  overflow: auto;
}
</style>
