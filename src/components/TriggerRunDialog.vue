<script setup lang="ts">
// 触发运行对话框(MOD-4)：选接入目标 + 参数注入(预置组件参数管理的 key,可改值)。
import { onMounted, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { runApi, type PipelineRun, type Param } from '@/api/run'
import { targetApi, type Target } from '@/api/target'
import { componentApi, type ComponentConfig } from '@/api/component'
import { artifactApi } from '@/api/artifact'
import { toast } from '@/utils/toast'
import { readErrorAxios, readDeleteVerdict } from '@/utils/pipeline'

const props = defineProps<{
  open: boolean
  pipelineId: string
  componentId?: string
}>()
const emit = defineEmits<{ close: []; triggered: [run: PipelineRun] }>()

const targets = ref<Target[]>([])
const targetId = ref('')
const namespace = ref('')
const params = ref<Param[]>([])
const triggering = ref(false)
// B-20 最小版：制品库版本 picker。G-2/G-14 修复后构建产物会登记进 artifacts，
// 这里把该组件已登记的版本列出来供一键填入 VERSION 参数（不做制品→发布语义
// 联动，那属完整版 B-20 的产品裁定范围）。
const artifactVersions = ref<string[]>([])
const pickedVersion = ref('')
// 后端结构化拒绝（如 B-11 生产强审批的 409 + reasons）：**原样**渲染，前端不加工、
// 不推断影响面。与流水线删除的 verdict 走同一套读取逻辑。
const refusal = ref<{ message: string; reasons: string[] } | null>(null)

onMounted(async () => {
  const p = await targetApi.list({ page: 1, pageSize: 100 })
  targets.value = p.items
  if (targets.value.length > 0) targetId.value = targets.value[0].id
})

// 打开时把组件参数管理里的 key 预置为本次运行参数(值可改)。
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    params.value = []
    artifactVersions.value = []
    pickedVersion.value = ''
    if (!props.componentId) return
    try {
      const res = await componentApi.listConfigs(props.componentId)
      const items: ComponentConfig[] = res?.items ?? res ?? []
      params.value = items.map((c) => ({ name: c.key, value: c.isSecret ? '' : (c.value ?? '') }))
    } catch {
      // 参数预置失败不阻塞触发
    }
    // 同批拉已登记制品版本（B-20 最小版）；失败仅隐藏 picker，不阻塞触发。
    try {
      const arts = await artifactApi.listByComponent(props.componentId, { page: 1, pageSize: 50 })
      artifactVersions.value = [...new Set(arts.items.map((a) => a.version).filter(Boolean))]
    } catch {
      // 版本列表失败不阻塞触发
    }
  },
)

// 选中版本 → 填入（或新增）名为 VERSION 的参数行；其余参数不动。
function applyVersion(v: string) {
  pickedVersion.value = v
  if (!v) return
  const row = params.value.find((p) => p.name === 'VERSION')
  if (row) row.value = v
  else params.value.unshift({ name: 'VERSION', value: v })
}

function addParam() {
  params.value.push({ name: '', value: '' })
}

async function trigger() {
  triggering.value = true
  refusal.value = null
  try {
    const run = await runApi.trigger(props.pipelineId, {
      targetId: targetId.value || undefined,
      targetNamespace: namespace.value || undefined,
      params: params.value.filter((p) => p.name.trim()),
    })
    toast.ok(`已触发运行 ${run.crName || run.id}`)
    emit('triggered', run)
    emit('close')
  } catch (e: unknown) {
    const { status, body, message } = readErrorAxios(e)
    // 带 reasons 的拒绝（409 等）是**策略**拒绝，不是故障：在对话框里留住 reasons，
    // 否则用户只会看到一句 toast，不知道"为什么不能触发、该怎么改"。
    const verdict = readDeleteVerdict(status, body)
    if (verdict.blocked) {
      refusal.value = { message: verdict.message, reasons: verdict.reasons }
      return
    }
    toast.err('触发失败：' + message)
  } finally {
    triggering.value = false
  }
}
</script>

<template>
  <Modal :open="open" title="触发运行" :width="560" @close="emit('close')">
    <div class="field">
      <label>接入目标</label>
      <select v-model="targetId" class="select">
        <option v-if="targets.length === 0" value="">（无可用目标）</option>
        <option v-for="c in targets" :key="c.id" :value="c.id">
          {{ c.name }}（{{ c.status === 'online' ? '在线' : '离线' }}）
        </option>
      </select>
    </div>
    <div class="field">
      <label>目标命名空间（可选）</label>
      <input v-model="namespace" class="input" placeholder="留空使用流水线默认" />
    </div>
    <div class="field">
      <label>运行参数（注入任务 command/args/env）</label>
      <div v-if="artifactVersions.length" class="ver-row">
        <span class="ver-label">从制品库选版本：</span>
        <select class="select" :value="pickedVersion" @change="applyVersion(($event.target as HTMLSelectElement).value)">
          <option value="">（手动输入）</option>
          <option v-for="v in artifactVersions" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>
      <div v-for="(p, i) in params" :key="i" class="kv-row">
        <input v-model="p.name" class="input" placeholder="name" />
        <input v-model="p.value" class="input" placeholder="value" />
        <button class="kv-del" @click="params.splice(i, 1)">×</button>
      </div>
      <button class="link-btn" @click="addParam">＋ 添加参数</button>
      <div class="hint">已预置组件参数管理中的 key；留空的 secret 值将由后端按 secretRef 解析。</div>
    </div>
    <div v-if="refusal" class="refusal">
      <b>{{ refusal.message }}</b>
      <ul v-if="refusal.reasons.length" class="reasons">
        <li v-for="(r, i) in refusal.reasons" :key="i">{{ r }}</li>
      </ul>
    </div>
    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="triggering || !targetId" @click="trigger">
        {{ triggering ? '触发中…' : '▶ 触发' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
/* 「策略拒绝」用 warning 语义色，而非 failed —— 它是"规则不允许"，不是"系统坏了"，
   与 PipelineEditorView 里删除 verdict 的观感区分开（§8.1 三通道：图标 + 文字 + 色）。 */
.refusal {
  background: var(--warning-bg); color: var(--warning-fg);
  border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-top: 4px;
}
.refusal .reasons { margin: 6px 0 0; padding-left: 20px; line-height: 1.8; }
.ver-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ver-label { font-size: 13px; color: var(--text-secondary, #666); white-space: nowrap; }
.ver-row .select { flex: 1; }
</style>
