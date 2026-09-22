<script setup lang="ts">
// 组件交付 → 流水线 Tab（§7.4）：列 = 名称 / 类型 / 版本 / 最近运行 / 操作（运行 · 编辑 · 删除）
// 右上 `＋ 新建流水线`。
//
// 删除契约（§7.4 + 附 C / N-5）：**前端零判断** —— 只做「强确认（输入名称）→ DELETE →
// 渲染后端 verdict」。`409 + {reasons}` 渲染「无法删除」弹窗，reasons **原样**来自后端
// （含进行中 / 待审批运行等逐条清单），前端不预先计算影响面、不加工文案。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import TriggerRunDialog from '@/components/TriggerRunDialog.vue'
import { pipelineApi, type Pipeline } from '@/api/pipeline'
import { runApi } from '@/api/run'
import { toast } from '@/utils/toast'
import {
  isDeleteConfirmed,
  pickLatestRuns,
  readDeleteVerdict,
  readErrorAxios,
  runPhaseClass,
  runPhaseLabel,
  type DeleteVerdict,
  type RunLike,
} from '@/utils/pipeline'

const props = defineProps<{ componentId: string }>()
const router = useRouter()

const pipelines = ref<Pipeline[]>([])
const latestRuns = ref<Record<string, RunLike>>({})
const loading = ref(true)

// ---- 最近运行：一次请求取回整组件，再本地按 pipelineId 分组（避免 N+1） ----
async function load() {
  loading.value = true
  try {
    const [p, runs] = await Promise.all([
      pipelineApi.listByComponent(props.componentId, { page: 1, pageSize: 100 }),
      runApi
        .listAll({ page: 1, pageSize: 200, componentId: props.componentId })
        .catch(() => ({ items: [] as RunLike[], total: 0, page: 1, pageSize: 0 })),
    ])
    pipelines.value = p.items
    latestRuns.value = pickLatestRuns(runs.items)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function runLabel(p: Pipeline): string {
  const r = latestRuns.value[p.id]
  return r ? runPhaseLabel(r.phase) : '—'
}

function runClass(p: Pipeline): string {
  const r = latestRuns.value[p.id]
  return r ? runPhaseClass(r.phase) : 'b-pend'
}

function runAt(p: Pipeline): string {
  const r = latestRuns.value[p.id]
  if (!r) return ''
  const t = r.startTime || r.createdAt
  return t ? String(t).replace('T', ' ').slice(0, 16) : ''
}

// ---------------------------------------------------------------------------
// 编辑 / 运行
// ---------------------------------------------------------------------------

// §7.4 / N-7：**不再**用 kind 限制可编排范围（早前仅允许 build，属过时客户端闸门）。
// hub 的 kind 是自由字符串（build/release/custom，无服务端校验），编排能力与 kind 无关。
function openEditor(p: Pipeline) {
  router.push(`/pipelines/${p.id}`)
}

const triggerRow = ref<Pipeline | null>(null)

function openTrigger(p: Pipeline) {
  triggerRow.value = p
}

function onTriggered(runId: string) {
  const pid = triggerRow.value?.id
  triggerRow.value = null
  if (pid) router.push(`/pipelines/${pid}/runs/${runId}`)
}

// ---------------------------------------------------------------------------
// 新建（§6.1 C1：保存后直接进编辑器，减少一次点击）
// ---------------------------------------------------------------------------

const createOpen = ref(false)
const creating = ref(false)
const form = ref({ name: '', kind: 'build' as Pipeline['kind'], description: '' })

const KIND_OPTIONS: { value: Pipeline['kind']; label: string }[] = [
  { value: 'build', label: '构建' },
  { value: 'release', label: '发布' },
  { value: 'custom', label: '自定义' },
]

function kindLabel(k: string): string {
  return KIND_OPTIONS.find((o) => o.value === k)?.label ?? k
}

function openCreate() {
  form.value = { name: '', kind: 'build', description: '' }
  createOpen.value = true
}

async function submitCreate() {
  const name = form.value.name.trim()
  if (!name) {
    toast.err('请填写流水线名称')
    return
  }
  creating.value = true
  try {
    // componentId 由当前组件上下文锁定，不允许在弹窗里改（避免挂错组件）。
    const created = await pipelineApi.create({
      componentId: props.componentId,
      name,
      kind: form.value.kind,
      description: form.value.description.trim() || undefined,
    })
    toast.ok('流水线已创建')
    createOpen.value = false
    // §6.1 C1：新建保存后**直接进编辑器**
    router.push(`/pipelines/${created.id}`)
  } catch (e: unknown) {
    const { message } = readErrorAxios(e)
    toast.err('创建失败：' + message)
  } finally {
    creating.value = false
  }
}

// ---------------------------------------------------------------------------
// 删除（§7.4：强确认 → DELETE → 渲染后端 verdict）
// ---------------------------------------------------------------------------

const deleteRow = ref<Pipeline | null>(null)
const deleteConfirmText = ref('')
const deleting = ref(false)
const verdict = ref<DeleteVerdict | null>(null)

const canDelete = computed(
  () => !!deleteRow.value && isDeleteConfirmed(deleteConfirmText.value, deleteRow.value.name),
)

function openDelete(p: Pipeline) {
  deleteRow.value = p
  deleteConfirmText.value = ''
  verdict.value = null
}

function closeDelete() {
  deleteRow.value = null
  deleteConfirmText.value = ''
  verdict.value = null
}

async function submitDelete() {
  const p = deleteRow.value
  if (!p || !canDelete.value) return
  deleting.value = true
  try {
    await pipelineApi.remove(p.id)
    toast.ok(`流水线「${p.name}」已删除（历史运行日志保留）`)
    closeDelete()
    await load()
  } catch (e: unknown) {
    const { status, body } = readErrorAxios(e)
    const v = readDeleteVerdict(status, body)
    if (v.blocked) {
      // 关掉强确认弹窗，改开「无法删除」弹窗（reasons 逐条来自后端）
      deleteRow.value = null
      deleteConfirmText.value = ''
      verdict.value = v
    } else {
      toast.err('删除失败：' + v.message)
    }
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="spacer"></div>
      <span class="sub">共 {{ pipelines.length }} 条流水线</span>
      <button class="btn btn-primary btn-sm" @click="openCreate">＋ 新建流水线</button>
    </div>

    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="pipelines.length === 0" class="empty">暂无流水线</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>版本</th>
            <th>最近运行</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pipelines" :key="p.id">
            <td>
              <a class="pl-name" @click="openEditor(p)">{{ p.name }}</a>
              <div v-if="p.description" class="pl-desc">{{ p.description }}</div>
            </td>
            <td><span class="chip">{{ kindLabel(p.kind) }}</span></td>
            <td class="mono">v{{ p.version }}</td>
            <td>
              <span class="badge" :class="runClass(p)">
                <span class="pt"></span>{{ runLabel(p) }}
              </span>
              <span v-if="runAt(p)" class="run-at mono">{{ runAt(p) }}</span>
            </td>
            <td class="ops">
              <a @click="openTrigger(p)">运行</a>
              <a @click="openEditor(p)">编辑</a>
              <a class="danger" @click="openDelete(p)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新建流水线 -->
    <Modal :open="createOpen" title="新建流水线" @close="createOpen = false">
      <div class="field">
        <label>名称</label>
        <input v-model="form.name" class="input" placeholder="如 日常流水线 / 生产发布" />
      </div>
      <div class="field">
        <label>类型</label>
        <select v-model="form.kind" class="select">
          <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div class="hint">仅作分类标签，不限制可编排的内容。</div>
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="form.description" class="input" placeholder="可选" />
      </div>
      <div class="field">
        <label>所属组件</label>
        <input class="input mono" :value="componentId" disabled />
        <div class="hint">由当前组件上下文锁定。</div>
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="creating" @click="submitCreate">
          {{ creating ? '创建中…' : '创建并编排' }}
        </button>
      </template>
    </Modal>

    <!-- 删除强确认 -->
    <Modal
      :open="!!deleteRow"
      :title="deleteRow ? `删除流水线 ${deleteRow.name}？` : '删除流水线'"
      @close="closeDelete"
    >
      <p class="del-lead">
        此操作不可撤销。若该流水线仍有<b>进行中</b>或<b>待审批</b>的运行，后端将拒绝删除并列出原因。
      </p>
      <div class="field">
        <label>请输入流水线名称以确认</label>
        <input v-model="deleteConfirmText" class="input mono" :placeholder="deleteRow?.name" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="closeDelete">取消</button>
        <button class="btn btn-danger" :disabled="!canDelete || deleting" @click="submitDelete">
          {{ deleting ? '删除中…' : '删除' }}
        </button>
      </template>
    </Modal>

    <!-- 后端 verdict：无法删除（reasons 原样渲染） -->
    <Modal :open="!!verdict" title="无法删除" @close="verdict = null">
      <p class="del-lead">{{ verdict?.message }}</p>
      <ul v-if="verdict?.reasons.length" class="reasons">
        <li v-for="(r, i) in verdict.reasons" :key="i">{{ r }}</li>
      </ul>
      <template #foot>
        <button class="btn btn-pearl" @click="verdict = null">知道了</button>
      </template>
    </Modal>

    <TriggerRunDialog
      :open="!!triggerRow"
      :pipeline-id="triggerRow?.id ?? ''"
      :component-id="componentId"
      @close="triggerRow = null"
      @triggered="(r) => onTriggered(r.id)"
    />
  </div>
</template>

<style scoped>
.pl-name { font-weight: 600; cursor: pointer; }
.pl-name:hover { color: var(--accent); }
.pl-desc { font-size: 12px; color: var(--text-sub); margin-top: 2px; }
.run-at { font-size: 12px; color: var(--text-sub); margin-left: 8px; }
.ops { display: flex; gap: 12px; white-space: nowrap; }
.ops a { cursor: pointer; font-size: 13px; }
.ops a:hover { color: var(--accent); }
.ops a.danger:hover { color: var(--failed-fg); }
.del-lead { font-size: 13px; color: var(--text-sub); margin: 0 0 14px; line-height: 1.6; }
.reasons { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.9; }
</style>
