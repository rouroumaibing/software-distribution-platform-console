<script setup lang="ts">
// 三态子任务表单(MOD-3, CONSOLE-MODULES §4)：
// Build=命令型(镜像+command+args) · Release=chart/manifest+values · Approval=审批。
// 保存 = POST /stages/:stageId/tasks 或 PUT /tasks/:id。
import { computed, reactive, ref, watch } from 'vue'
import Drawer from './Drawer.vue'
import {
  pipelineApi,
  type PipelineTaskTemplate,
  type PipelineTaskType,
  type ReleaseConfig,
} from '@/api/pipeline'
import { toast } from '@/utils/toast'

const props = defineProps<{
  open: boolean
  stageId: string
  task?: PipelineTaskTemplate | null
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const saving = ref(false)

// ---- 表单状态 ----
const form = reactive({
  name: '',
  type: 'Build' as PipelineTaskType,
  image: '',
  commandLine: '', // 空格分隔,提交时拆成 command + args
  scriptPath: '',
  timeoutSeconds: 600,
  maxRetries: 0,
  produces: '',
  consumes: '',
  // Release
  chartRepo: '',
  chartName: '',
  chartVersion: '',
  chartUrl: '',
  values: [] as { key: string; value: string }[],
  manifest: '',
  // Approval
  approvalDesc: '',
})

watch(
  () => [props.open, props.task],
  () => {
    if (!props.open) return
    const t = props.task
    form.name = t?.name ?? ''
    form.type = t?.type ?? 'Build'
    form.image = t?.image ?? ''
    form.commandLine = [...(t?.command ?? []), ...(t?.args ?? [])].join(' ')
    form.scriptPath = t?.scriptPath ?? ''
    form.timeoutSeconds = t?.timeoutSeconds ?? 600
    form.maxRetries = 0
    form.produces = (t?.produces ?? []).join(', ')
    form.consumes = (t?.consumes ?? []).join(', ')
    form.chartRepo = t?.releaseConfig?.chart?.repo ?? ''
    form.chartName = t?.releaseConfig?.chart?.name ?? ''
    form.chartVersion = t?.releaseConfig?.chart?.version ?? ''
    form.chartUrl = t?.releaseConfig?.chart?.chartUrl ?? ''
    form.values = Object.entries(t?.releaseConfig?.values ?? {}).map(([key, value]) => ({
      key,
      value,
    }))
    form.manifest = t?.releaseConfig?.manifest ?? ''
    form.approvalDesc = (t?.approvalConfig?.description as string) ?? ''
  },
  { immediate: true },
)

const title = computed(() => (props.task ? `编辑子任务 · ${props.task.name}` : '新建子任务'))

const previewCmd = computed(() => form.commandLine.trim() || '（未填写命令）')

function addValue() {
  form.values.push({ key: '', value: '' })
}

function splitCsv(s: string): string[] {
  return s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

async function save() {
  if (!form.name.trim()) {
    toast.err('请填写子任务名称')
    return
  }
  const payload: Partial<PipelineTaskTemplate> = {
    name: form.name.trim(),
    type: form.type,
    timeoutSeconds: Number(form.timeoutSeconds) || 0,
  }

  if (form.type === 'Build') {
    const parts = form.commandLine.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0 && !form.scriptPath.trim()) {
      toast.err('Build 任务需要填写命令（或使用脚本逃生通道）')
      return
    }
    payload.image = form.image.trim() || undefined
    payload.command = parts.length > 0 ? [parts[0]] : []
    payload.args = parts.slice(1)
    payload.scriptPath = form.scriptPath.trim() || undefined
    payload.produces = splitCsv(form.produces)
    payload.consumes = splitCsv(form.consumes)
  } else if (form.type === 'Release') {
    const values: Record<string, string> = {}
    for (const kv of form.values) if (kv.key.trim()) values[kv.key.trim()] = kv.value
    const rc: ReleaseConfig = { values }
    if (form.manifest.trim()) {
      rc.manifest = form.manifest
    } else {
      rc.chart = {
        repo: form.chartRepo.trim() || undefined,
        name: form.chartName.trim() || undefined,
        version: form.chartVersion.trim() || undefined,
        chartUrl: form.chartUrl.trim() || undefined,
      }
      if (!rc.chart.name && !rc.chart.chartUrl) {
        toast.err('Release 任务需要 chart 名称或 chartUrl（或填写 manifest）')
        return
      }
    }
    payload.releaseConfig = rc
    payload.image = form.image.trim() || undefined
  } else {
    payload.approvalConfig = { description: form.approvalDesc.trim() }
  }

  saving.value = true
  try {
    if (props.task) {
      await pipelineApi.updateTask(props.task.id, payload)
    } else {
      await pipelineApi.createTask(props.stageId, payload)
    }
    toast.ok('子任务已保存')
    emit('saved')
    emit('close')
  } catch (e: any) {
    toast.err('保存失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Drawer :open="open" :title="title" :width="480" @close="emit('close')">
    <!-- 执行方式三选一 -->
    <div class="mode-row">
      <div class="mode" :class="{ sel: form.type === 'Build' }" @click="form.type = 'Build'">
        <div class="mi">⌘</div>
        <div class="ml">命令 Build</div>
        <div class="md">构建 / 测试</div>
      </div>
      <div class="mode" :class="{ sel: form.type === 'Release' }" @click="form.type = 'Release'">
        <div class="mi">⬇</div>
        <div class="ml">发布 Release</div>
        <div class="md">chart / manifest</div>
      </div>
      <div class="mode" :class="{ sel: form.type === 'Approval' }" @click="form.type = 'Approval'">
        <div class="mi">✓</div>
        <div class="ml">审批 Approval</div>
        <div class="md">人工卡点</div>
      </div>
    </div>

    <div class="field">
      <label>子任务名称</label>
      <input v-model="form.name" class="input" placeholder="如 go build / 上线审批" />
    </div>

    <!-- Build 子表单 -->
    <template v-if="form.type === 'Build'">
      <div class="field">
        <label>工具镜像 Image</label>
        <input v-model="form.image" class="input" placeholder="如 golang:1.22 / node:22" />
        <div class="hint">命令在该镜像内执行，无需把脚本上传到代码仓库。</div>
      </div>
      <div class="field">
        <label>命令（空格分隔，首个词为 command，其余为 args）</label>
        <input v-model="form.commandLine" class="input mono" placeholder="如 go build ./... 或 pytest -q" />
        <div class="hint">预览：<span class="chip">{{ previewCmd }}</span></div>
        <div class="hint">runner 仅确认正常退出（退出码 0 = 成功），不解析输出内容。</div>
      </div>
      <div class="two">
        <div class="field">
          <label>超时（秒）</label>
          <input v-model.number="form.timeoutSeconds" type="number" class="input" />
        </div>
        <div class="field">
          <label>最大重试</label>
          <input v-model.number="form.maxRetries" type="number" class="input" />
        </div>
      </div>
      <div class="two">
        <div class="field">
          <label>产出 produces</label>
          <input v-model="form.produces" class="input" placeholder="逗号分隔" />
        </div>
        <div class="field">
          <label>消费 consumes</label>
          <input v-model="form.consumes" class="input" placeholder="逗号分隔" />
        </div>
      </div>
      <details class="hint" style="margin-top: 4px">
        <summary style="cursor: pointer">脚本逃生通道（可选）</summary>
        <div class="field" style="margin-top: 10px">
          <label>Script Path</label>
          <input v-model="form.scriptPath" class="input" placeholder="如 scripts/build.sh（留空则用上方命令）" />
        </div>
      </details>
    </template>

    <!-- Release 子表单 -->
    <template v-else-if="form.type === 'Release'">
      <div class="field">
        <label>Chart 源</label>
        <div class="kv-row">
          <input v-model="form.chartRepo" class="input" placeholder="repo（helm repo URL）" />
          <input v-model="form.chartName" class="input" placeholder="name" />
        </div>
        <div class="kv-row">
          <input v-model="form.chartVersion" class="input" placeholder="version" />
          <input v-model="form.chartUrl" class="input" placeholder="chartUrl（可选，优先级高）" />
        </div>
      </div>
      <div class="field">
        <label>Values（来自参数管理注入）</label>
        <div v-for="(kv, i) in form.values" :key="i" class="kv-row">
          <input v-model="kv.key" class="input" placeholder="key，如 image.tag" />
          <input v-model="kv.value" class="input" placeholder="value 或 ${参数key}" />
          <button class="kv-del" @click="form.values.splice(i, 1)">×</button>
        </div>
        <button class="link-btn" @click="addValue">＋ 添加 value（可引用参数管理 key）</button>
        <div class="hint">触发时由 hub 把参数管理的值以 --set 注入 chart。</div>
      </div>
      <div class="field">
        <label>Manifest（可选，填写后改为 kubectl apply）</label>
        <textarea v-model="form.manifest" class="input" placeholder="YAML 内容；留空则走 helm chart"></textarea>
      </div>
    </template>

    <!-- Approval 子表单 -->
    <template v-else>
      <div class="field">
        <label>审批说明</label>
        <textarea v-model="form.approvalDesc" class="input" placeholder="如：生产环境发布前需负责人确认"></textarea>
      </div>
      <div class="hint">审批节点运行时流水线暂停，等待 hub 收到 decision 后继续。</div>
    </template>

    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存子任务' }}
      </button>
    </template>
  </Drawer>
</template>

<style scoped>
.mode-row { display: flex; gap: 8px; margin-bottom: 20px; }
.mode {
  flex: 1; border: 1.5px solid var(--hairline); border-radius: 10px;
  padding: 12px 6px; text-align: center; cursor: pointer; transition: 0.15s;
}
.mode.sel { border-color: var(--action-blue); background: var(--action-blue-soft); }
.mi { font-size: 18px; }
.ml { font-size: 13px; font-weight: 600; margin-top: 4px; }
.md { font-size: 11px; color: var(--sub); margin-top: 2px; }
</style>
