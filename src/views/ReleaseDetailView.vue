<script setup lang="ts">
// 发布/灰度详情(CONSOLE-LAYOUT §3.6)：步骤器 + 任务进度 + 控制按钮(G4 端点已接)。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import { runApi, type PipelineRun, type TaskRun } from '@/api/run'
import { toast } from '@/utils/toast'

const route = useRoute()
const runId = route.params.id as string

const run = ref<PipelineRun>()
const tasks = ref<TaskRun[]>([])
const loading = ref(true)
const controlling = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

async function pollOnce() {
  if (!run.value) return
  const p = await runApi.progress(runId)
  run.value.phase = p.phase
  tasks.value = p.tasks
}

onMounted(async () => {
  run.value = await runApi.get(runId)
  tasks.value = await runApi.listTasks(runId)
  loading.value = false
  timer = setInterval(async () => {
    if (run.value && ['Running', 'Pending', 'WaitingApproval'].includes(run.value.phase)) {
      await pollOnce()
    }
  }, 3000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// Release 任务即发布单元;Rollout 步骤(10/50/100)用任务进度近似,精确权重
// 需 runner 把 Rollout.Status.CurrentWeight 同步进 TaskRun(后续增强)。
const releaseTasks = computed(() => tasks.value.filter((t) => t.type === 'Release'))
const doneCount = computed(() => tasks.value.filter((t) => t.phase === 'Succeeded').length)
const percent = computed(() =>
  tasks.value.length === 0 ? 0 : Math.round((doneCount.value / tasks.value.length) * 100),
)

// 控制目标:第一个尚未终态的 Release 任务(pause/promote/rollback 都打给它)。
const controlTarget = computed(
  () => releaseTasks.value.find((t) => !['Succeeded', 'Failed', 'Skipped'].includes(t.phase)),
)

const ACTION_LABEL: Record<string, string> = { pause: '暂停', promote: '晋升', rollback: '回滚' }

async function control(action: 'pause' | 'promote' | 'rollback') {
  const task = controlTarget.value
  if (!task) {
    toast.err('没有进行中的发布任务可控制')
    return
  }
  if (
    action === 'rollback' &&
    !window.confirm(`确认回滚「${task.taskName}」？金丝雀流量将回到 0%，且该发布不可再晋升。`)
  ) {
    return
  }
  controlling.value = true
  try {
    await runApi.rollout(runId, task.taskName, action)
    toast.ok(`已下发${ACTION_LABEL[action]}指令到 ${task.taskName}`)
    await pollOnce()
  } catch (e) {
    toast.err(e instanceof Error ? e.message : `${ACTION_LABEL[action]}指令下发失败`)
  } finally {
    controlling.value = false
  }
}

const steps = computed(() => {
  const p = percent.value
  return [
    { label: '10%', state: p >= 10 ? 'done' : p > 0 ? 'active' : 'todo' },
    { label: '50%', state: p >= 50 ? 'done' : p >= 10 ? 'active' : 'todo' },
    { label: '100%', state: p >= 100 ? 'done' : p >= 50 ? 'active' : 'todo' },
  ]
})
</script>

<template>
  <div>
    <div v-if="loading" class="loading">加载中…</div>
    <template v-else-if="run">
      <div class="page-head">
        <div class="crumb">发布 / <b>{{ run.crName || run.id.slice(0, 8) }}</b></div>
        <h1 class="title">灰度发布</h1>
        <div style="margin-top: 8px; display: flex; gap: 14px; align-items: center">
          <StatusBadge :phase="run.phase" />
          <span class="sub">策略：金丝雀 10% → 50% → 100%</span>
        </div>
      </div>

      <div class="card">
        <div class="steps">
          <div v-for="(s, i) in steps" :key="i" class="step" :class="s.state">
            <div class="circle">{{ s.state === 'done' ? '✓' : s.label.replace('%', '') }}</div>
            <div class="lbl">{{ s.label }}</div>
          </div>
        </div>
        <div class="progress"><i :style="{ width: percent + '%' }"></i></div>
        <div class="metrics">
          <div class="metric"><div class="ml">任务完成</div><div class="mv">{{ doneCount }} / {{ tasks.length }}</div></div>
          <div class="metric"><div class="ml">发布单元</div><div class="mv">{{ releaseTasks.length }}</div></div>
          <div class="metric">
            <div class="ml">失败任务</div>
            <div class="mv" :style="{ color: tasks.some((t) => t.phase === 'Failed') ? 'var(--failed-fg)' : 'var(--succeeded-fg)' }">
              {{ tasks.filter((t) => t.phase === 'Failed').length }}
            </div>
          </div>
        </div>
        <div class="toolbar" style="margin-top: 18px">
          <button
            class="btn btn-pearl"
            :disabled="controlling || !controlTarget"
            :title="controlTarget ? `暂停 ${controlTarget.taskName} 在当前权重` : '没有进行中的发布任务'"
            @click="control('pause')"
          >⏸ 暂停</button>
          <button
            class="btn btn-primary"
            :disabled="controlling || !controlTarget"
            :title="controlTarget ? `晋升 ${controlTarget.taskName} 到下一步` : '没有进行中的发布任务'"
            @click="control('promote')"
          >⤴ 晋升</button>
          <button
            class="btn btn-danger"
            :disabled="controlling || !controlTarget"
            :title="controlTarget ? `回滚 ${controlTarget.taskName}` : '没有进行中的发布任务'"
            @click="control('rollback')"
          >↩ 回滚</button>
          <span v-if="controlTarget" class="sub" style="margin-left: 8px">
            控制目标：<b>{{ controlTarget.taskName }}</b>
          </span>
          <span v-else class="sub" style="margin-left: 8px">当前没有进行中的 Release 任务</span>
        </div>
      </div>

      <h2 class="h2">发布单元</h2>
      <div class="card flush">
        <div v-if="releaseTasks.length === 0" class="empty">本次运行没有 Release 类型任务</div>
        <table v-else class="table">
          <thead><tr><th>任务</th><th>阶段</th><th>状态</th><th>退出码</th></tr></thead>
          <tbody>
            <tr v-for="t in releaseTasks" :key="t.id">
              <td><b>{{ t.taskName }}</b></td>
              <td>{{ t.stageName }}</td>
              <td><StatusBadge :phase="t.phase" /></td>
              <td class="mono">{{ t.exitCode ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.steps { display: flex; align-items: center; margin-top: 10px; }
.step { flex: 1; text-align: center; position: relative; }
.step .circle {
  width: 30px; height: 30px; border-radius: 50%; margin: 0 auto 8px;
  display: grid; place-items: center; font-size: 13px; font-weight: 700;
  border: 2px solid var(--hairline); background: var(--surface); color: var(--sub);
}
.step.done .circle { background: var(--succeeded-bg); border-color: var(--succeeded-fg); color: var(--succeeded-fg); }
.step.active .circle { background: var(--running-bg); border-color: var(--action-blue); color: var(--action-blue); }
.step .lbl { font-size: 12px; color: var(--sub); }
.step.active .lbl { color: var(--action-blue); font-weight: 600; }
.step:not(:last-child)::after {
  content: ""; position: absolute; top: 15px; left: 50%; width: 100%; height: 2px;
  background: var(--hairline); z-index: -1;
}
.progress { height: 8px; border-radius: 9999px; background: var(--parchment); overflow: hidden; margin-top: 20px; }
.progress > i { display: block; height: 100%; background: var(--action-blue); border-radius: 9999px; transition: width 0.4s; }
.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 16px; }
.metric { background: var(--parchment); border-radius: 10px; padding: 14px; }
.metric .ml { font-size: 12px; color: var(--sub); }
.metric .mv { font-size: 22px; font-weight: 700; margin-top: 4px; }
</style>
