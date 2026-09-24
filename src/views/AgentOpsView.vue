<script setup lang="ts">
// 接入目标的操作台账（§9.5 / §9.9 / UNIMPLEMENTED §16.5）。
// 左侧 = 该目标的操作历史（exec / install / upgrade，含 queued→running→succeeded|failed）；
// 右侧 = 选中操作的实时输出与状态（SSE 订阅 /agent-ops/:id/stream，离线重连重放全量日志）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { agentOpApi, agentOpStatusLabel, agentOpTypeLabel, streamAgentOp, type AgentOp, type AgentOpLog, type AgentOpStatus } from '@/api/agentOp'
import { toast } from '@/utils/toast'

const props = defineProps<{ targetId: string }>()

const ops = ref<AgentOp[]>([])
const total = ref(0)
const loading = ref(true)
const selectedId = ref('')
const selected = ref<AgentOp | null>(null)
const logs = ref<AgentOpLog[]>([])
const streaming = ref(false)

// exec 表单（exec 是环境级操作，需 envId；install/upgrade 是目标级，无需额外输入）。
const execEnvId = ref('')
const execCommand = ref('')
const execScript = ref('')
const acting = ref(false)

const statusClass = (s: AgentOpStatus) => ({
  'op-queued': s === 'queued',
  'op-running': s === 'running',
  'op-succeeded': s === 'succeeded',
  'op-failed': s === 'failed',
})

const detailPreview = (op: AgentOp) => {
  const d = op.detail || ''
  return d.length > 60 ? d.slice(0, 60) + '…' : d
}

let ctrl: { abort: () => void } | null = null
function stopStream() {
  ctrl?.abort()
  ctrl = null
  streaming.value = false
}

async function loadLedger() {
  loading.value = true
  try {
    const p = await agentOpApi.listByTarget(props.targetId, { page: 1, pageSize: 50 })
    ops.value = p.items
    total.value = p.total
    if (!selectedId.value && p.items.length) await selectOp(p.items[0])
  } catch (e) {
    toast.err('加载操作台账失败：' + msg(e))
  } finally {
    loading.value = false
  }
}

async function selectOp(op: AgentOp) {
  stopStream()
  selectedId.value = op.id
  selected.value = op
  logs.value = []
  streaming.value = true
  // 始终走 SSE：终端态会重放历史日志后立即 end；运行中则持续推送。
  ctrl = streamAgentOp(op.id, {
    onStatus: (s) => {
      selected.value = s
      const i = ops.value.findIndex((o) => o.id === s.id)
      if (i >= 0) ops.value[i] = s
    },
    onLog: (l) => {
      logs.value = [...logs.value, l].sort((a, b) => a.seq - b.seq)
    },
    onEnd: () => {
      streaming.value = false
      void loadLedger()
    },
    onError: (err) => {
      streaming.value = false
      toast.err('日志流中断：' + msg(err))
    },
  })
}

async function doInstall() {
  acting.value = true
  try {
    const op = await agentOpApi.install(props.targetId)
    toast.ok('已排队安装 Runner')
    await loadLedger()
    await selectOp(op)
  } catch (e) {
    toast.err('安装排队失败：' + msg(e))
  } finally {
    acting.value = false
  }
}

async function doUpgrade() {
  acting.value = true
  try {
    const op = await agentOpApi.upgrade(props.targetId)
    toast.ok('已排队升级 Runner')
    await loadLedger()
    await selectOp(op)
  } catch (e) {
    toast.err('升级排队失败：' + msg(e))
  } finally {
    acting.value = false
  }
}

async function doExec() {
  if (!execEnvId.value.trim()) {
    toast.err('请填写执行环境 ID（envId）')
    return
  }
  if (!execCommand.value.trim() && !execScript.value.trim()) {
    toast.err('命令与脚本至少填写一个')
    return
  }
  acting.value = true
  try {
    const op = await agentOpApi.exec(execEnvId.value.trim(), {
      command: execCommand.value.trim() || undefined,
      script: execScript.value.trim() || undefined,
    })
    toast.ok('已排队命令执行')
    await loadLedger()
    await selectOp(op)
  } catch (e) {
    toast.err('执行排队失败：' + msg(e))
  } finally {
    acting.value = false
  }
}

function msg(e: unknown): string {
  const anyE = e as { response?: { data?: { error?: string } }; message?: string }
  return anyE?.response?.data?.error || anyE?.message || '未知错误'
}

const logText = computed(() => logs.value.map((l) => l.chunk).join(''))

onMounted(loadLedger)
onBeforeUnmount(stopStream)
</script>

<template>
  <div>
    <div class="page-head">
      <h1 class="title">接入目标操作台账</h1>
      <div class="sub">
        <span class="mono">{{ targetId.slice(0, 8) }}</span> · 直连执行 / Runner 安装升级的历史与实时输出（hub 侧已落地，console 消费端）
      </div>
    </div>

    <div class="ops-grid">
      <!-- 台账列表 -->
      <div class="card side">
        <div class="toolbar" style="margin: 0 0 8px">
          <h2 class="h2" style="margin: 0">操作历史</h2>
          <div class="spacer"></div>
          <button class="btn btn-pearl btn-sm" :disabled="loading" @click="loadLedger">刷新</button>
        </div>
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="ops.length === 0" class="empty">暂无操作记录</div>
        <div v-else class="op-list">
          <div v-for="o in ops" :key="o.id" class="op-item" :class="{ on: o.id === selectedId }" @click="selectOp(o)">
            <div class="op-item-top">
              <span class="chip">{{ agentOpTypeLabel(o.opType) }}</span>
              <span class="badge" :class="statusClass(o.status)">{{ agentOpStatusLabel(o.status) }}</span>
            </div>
            <div class="op-item-detail mono">{{ detailPreview(o) }}</div>
            <div class="op-item-time">{{ new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</div>
          </div>
        </div>
      </div>

      <!-- 详情 + 实时输出 -->
      <div class="card main">
        <div v-if="!selected" class="empty">从左侧选择一个操作查看实时输出</div>
        <template v-else>
          <div class="detail-head">
            <div>
              <span class="chip">{{ agentOpTypeLabel(selected.opType) }}</span>
              <span class="badge" :class="statusClass(selected.status)">{{ agentOpStatusLabel(selected.status) }}</span>
              <span v-if="streaming" class="live-dot" title="实时流">● 实时</span>
            </div>
            <div class="spacer"></div>
            <div class="op-actions">
              <button class="btn btn-pearl btn-sm" :disabled="acting" @click="doInstall">安装 Runner</button>
              <button class="btn btn-pearl btn-sm" :disabled="acting" @click="doUpgrade">升级 Runner</button>
            </div>
          </div>

          <div class="detail-meta mono" v-if="selected.detail || selected.message">
            <div v-if="selected.detail"><b>参数</b> {{ selected.detail }}</div>
            <div v-if="selected.message"><b>结果</b> {{ selected.message }}</div>
          </div>

          <div class="exec-box" v-if="selected.opType === 'exec'">
            <div class="exec-title">再执行（exec 为环境级操作）</div>
            <div class="field">
              <label>环境 ID（envId）</label>
              <input v-model="execEnvId" class="input" type="text" placeholder="目标下某个环境的 UUID" />
            </div>
            <div class="field">
              <label>命令 command</label>
              <input v-model="execCommand" class="input" type="text" placeholder="如 kubectl get pods -n x" />
            </div>
            <div class="field">
              <label>或脚本 script</label>
              <textarea v-model="execScript" class="input" rows="3" placeholder="整段脚本（与 command 至少填一个）"></textarea>
            </div>
            <button class="btn btn-primary btn-sm" :disabled="acting" @click="doExec">排队执行</button>
          </div>

          <div class="log-head"><span class="sub mono">{{ selected.id.slice(0, 8) }}</span></div>
          <pre v-if="logText" class="log-out">{{ logText }}</pre>
          <div v-else-if="streaming" class="empty">等待输出…</div>
          <div v-else class="empty">该操作暂无输出</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ops-grid { display: grid; grid-template-columns: 340px 1fr; gap: 16px; align-items: start; }
.toolbar { display: flex; align-items: center; gap: 8px; }
.spacer { flex: 1; }
.op-list { display: flex; flex-direction: column; gap: 6px; }
.op-item { padding: 10px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; }
.op-item:hover { background: var(--accent-soft); }
.op-item.on { background: var(--action-blue-soft); border-color: var(--accent); }
.op-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.op-item-detail { font-size: 12px; color: var(--text); word-break: break-all; }
.op-item-time { font-size: 11px; color: var(--text-sub); margin-top: 2px; }
.detail-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.live-dot { color: var(--running-fg); font-size: 12px; }
.detail-meta { font-size: 12px; margin-bottom: 10px; line-height: 1.6; }
.detail-meta b { color: var(--text-sub); margin-right: 6px; }
.exec-box { border: 1px solid var(--hairline); border-radius: var(--radius-card); padding: 12px; margin-bottom: 12px; }
.exec-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.field { margin-bottom: 10px; }
.field > label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-sub); }
.input { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--hairline); border-radius: var(--radius-card); font-size: 13px; font-family: inherit; background: var(--surface); color: var(--text); }
.log-head { margin-bottom: 8px; }
.log-out { margin: 0; padding: 12px; background: var(--term-bg); color: var(--term-fg); border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; max-height: 56vh; overflow: auto; }
.chip { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; }
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; font-size: 12px; }
.op-queued { background: var(--pending-bg); color: var(--pending-fg); }
.op-running { background: var(--running-bg); color: var(--running-fg); }
.op-succeeded { background: var(--succeeded-bg); color: var(--succeeded-fg); }
.op-failed { background: var(--failed-bg); color: var(--failed-fg); }
</style>
