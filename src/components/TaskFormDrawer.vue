<script setup lang="ts">
// 子任务表单（MOD-3，§7.4 / 附 D.3）。
//
// ⚠️ 这里**不露** `Build` / `Release` / `Approval` 原词 —— 它们是内部派发码，不是用户
// 可选的分类（2026-09-17 拍板）。表单只呈现三组**配置**，`type` 由「填了哪组」派生：
//   填了发布配置（chart / manifest）→ 发布任务
//   填了审批人                      → 人工审核阶段
//   否则                            → 构建 / 运行任务
// 派生规则在 utils/pipeline.ts 的 deriveTaskType()（纯逻辑，有契约断言）。
// 保存 = POST /stages/:stageId/tasks（新建）或 PUT /tasks/:id（更新）。
import { computed, reactive, ref, watch } from 'vue'
import Drawer from './Drawer.vue'
import {
  pipelineApi,
  type PipelineTaskTemplate,
  type ReleaseConfig,
} from '@/api/pipeline'
import { toast } from '@/utils/toast'
import { deriveTaskType, taskNature, type TaskDerivationInput } from '@/utils/pipeline'

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
  // 构建 / 运行任务
  image: '',
  commandLine: '', // 空格分隔，提交时拆成 command + args
  scriptPath: '',
  timeoutSeconds: 600,
  maxRetries: 0,
  produces: '',
  consumes: '',
  // 发布任务（releaseConfig）
  chartRepo: '',
  chartName: '',
  chartVersion: '',
  chartUrl: '',
  values: [] as { key: string; value: string }[],
  manifest: '',
  // 人工审核阶段（approvalConfig）
  approvers: '',
  requiredApprovals: 1,
})

watch(
  () => [props.open, props.task],
  () => {
    if (!props.open) return
    const t = props.task
    form.name = t?.name ?? ''
    form.image = t?.image ?? ''
    form.commandLine = [...(t?.command ?? []), ...(t?.args ?? [])].join(' ')
    form.scriptPath = t?.scriptPath ?? ''
    form.timeoutSeconds = t?.timeoutSeconds ?? 600
    form.maxRetries = Number((t?.retryPolicy?.maxRetries as number) ?? 0)
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
    const approvers = (t?.approvalConfig?.allowedApprovers as string[] | undefined) ?? []
    form.approvers = approvers.join(', ')
    form.requiredApprovals = Number((t?.approvalConfig?.requiredApprovals as number) ?? 1) || 1
  },
  { immediate: true },
)

const title = computed(() => (props.task ? `编辑子任务 · ${props.task.name}` : '新建子任务'))

// ---- 派生 ----
const hasReleaseConfig = computed(
  () => !!(form.manifest.trim() || form.chartName.trim() || form.chartUrl.trim()),
)
const derivation = computed<TaskDerivationInput>(() => ({
  hasReleaseConfig: hasReleaseConfig.value,
  approvers: form.approvers,
}))
const nature = computed(() => taskNature(derivation.value))
/** Release 优先级高于 Approval：两组都填时如实说明，而不是静默丢弃一组。 */
const bothFilled = computed(() => hasReleaseConfig.value && form.approvers.trim() !== '')

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
  const type = deriveTaskType(derivation.value)
  const payload: Partial<PipelineTaskTemplate> = {
    name: form.name.trim(),
    type,
    timeoutSeconds: Number(form.timeoutSeconds) || 0,
  }

  if (type === 'Release') {
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
    }
    payload.releaseConfig = rc
    payload.image = form.image.trim() || undefined
    // 切到 Release 时清掉 approvalConfig，避免两组配置并存于一行（后端按 type 取用，
    // 但留着会让人误以为两者都生效）。
    payload.approvalConfig = undefined
  } else if (type === 'Approval') {
    payload.approvalConfig = {
      requiredApprovals: Math.max(1, Number(form.requiredApprovals) || 1),
      allowedApprovers: splitCsv(form.approvers),
    }
    payload.releaseConfig = undefined
  } else {
    const parts = form.commandLine.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0 && !form.scriptPath.trim()) {
      toast.err('「构建 / 运行任务」需要填写命令（或使用脚本逃生通道）')
      return
    }
    payload.image = form.image.trim() || undefined
    payload.command = parts.length > 0 ? [parts[0]] : []
    payload.args = parts.slice(1)
    payload.scriptPath = form.scriptPath.trim() || undefined
    payload.produces = splitCsv(form.produces)
    payload.consumes = splitCsv(form.consumes)
    payload.retryPolicy = { maxRetries: Number(form.maxRetries) || 0 }
    payload.releaseConfig = undefined
    payload.approvalConfig = undefined
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
  <Drawer :open="open" :title="title" :width="520" @close="emit('close')">
    <!-- 派生出的产品语言：只读展示，明确说明"不是类别选择" -->
    <div class="nature-row">
      <span class="chip">{{ nature }}</span>
      <span class="nature-hint">由填写内容自动识别，非类别选择</span>
    </div>
    <div v-if="bothFilled" class="nature-warn">
      同时填了发布配置与审批人 —— 按「发布任务」处理（发布优先），审批人字段将被忽略。
    </div>

    <div class="field">
      <label>子任务名称</label>
      <input v-model="form.name" class="input" placeholder="如 go build / 上线审批" />
    </div>

    <!-- 一、运行环境与命令 -->
    <div class="sec">一、运行环境与命令</div>
    <div class="field">
      <label>工具镜像 Image</label>
      <input v-model="form.image" class="input" placeholder="如 golang:1.27 / node:22" />
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
    <details class="hint" style="margin-bottom: 16px">
      <summary style="cursor: pointer">脚本逃生通道（可选）</summary>
      <div class="field" style="margin-top: 10px">
        <label>Script Path</label>
        <input v-model="form.scriptPath" class="input" placeholder="如 scripts/build.sh（留空则用上方命令）" />
      </div>
    </details>

    <!-- 二、发布配置 -->
    <div class="sec">二、发布配置 <span class="sec-note">填了即识别为「发布任务」</span></div>
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

    <!-- 三、人工审核 -->
    <div class="sec">三、人工审核 <span class="sec-note">填了审批人即识别为「人工审核阶段」</span></div>
    <div class="two">
      <div class="field">
        <label>审批人（逗号分隔，留空 = 有项目权限者均可审批）</label>
        <input v-model="form.approvers" class="input mono" placeholder="如 alice@corp.com, bob@corp.com" />
      </div>
      <div class="field">
        <label>需要几人通过</label>
        <input v-model.number="form.requiredApprovals" type="number" min="1" class="input" />
      </div>
    </div>
    <div class="hint" style="margin-bottom: 4px">
      审批节点运行时流水线暂停，等待 hub 收到 decision 后继续。
    </div>

    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存子任务' }}
      </button>
    </template>
  </Drawer>
</template>

<style scoped>
.nature-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.nature-hint { font-size: 12px; color: var(--text-sub); }
.nature-warn {
  font-size: 12px; line-height: 1.6; color: var(--warning-fg);
  background: var(--warning-bg); border-radius: 8px; padding: 8px 12px; margin-bottom: 16px;
}
.sec {
  font-size: 12px; font-weight: 700; color: var(--text-sub);
  text-transform: none; letter-spacing: 0.02em;
  border-top: 1px solid var(--hairline); padding-top: 14px; margin: 4px 0 12px;
}
.sec-note { font-weight: 400; color: var(--text-sub); margin-left: 6px; }
.kv-del {
  flex: 0 0 auto; background: none; border: none; color: var(--text-sub);
  cursor: pointer; font-size: 16px; padding: 0 4px;
}
.kv-del:hover { color: var(--failed-fg); }
</style>
