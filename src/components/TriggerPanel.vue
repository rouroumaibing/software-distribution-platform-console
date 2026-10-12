<script setup lang="ts">
// 触发器面板（ui-12 §4.3 / N-21）：流水线编辑器「触发器」入口的弹窗形态。
// 列表（类型图标 + 名称 + 启停开关 + 最近触发）+ 按类型配置 + cron 未来 5 次
// 预览（服务端校验，非法即时 400）+ webhook 签名仅展示一次 / 可轮换。
// 编辑器是单页 + 弹窗形态（非四 Tab），入口见 PipelineEditorView 工具栏——
// 与「编辑信息 / 版本历史」同一交互家族，落地偏差在 ui-12 修订时说明。
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import { triggerApi, type PipelineTrigger, type TriggerSpec, type TriggerType } from '@/api/trigger'
import { toast } from '@/utils/toast'
import { readErrorAxios } from '@/utils/pipeline'

const props = defineProps<{ open: boolean; pipelineId: string }>()
const emit = defineEmits<{ close: [] }>()

const items = ref<PipelineTrigger[]>([])
const loading = ref(false)
const creating = ref(false)
const saving = ref(false)

// 新建表单
const name = ref('')
const type = ref<TriggerType>('cron')
const enabled = ref(true)
const cronExpr = ref('')
const cronNext = ref<string[]>([])
const cronErr = ref('')
const onPipelineId = ref('')
const statuses = ref('Succeeded')
// 一次性展示的新 token（create / rotate 返回）
const revealedToken = ref('')

const TYPE_META: Record<TriggerType, { label: string; icon: string }> = {
  cron: { label: '定时', icon: '⏰' },
  webhook: { label: 'Webhook', icon: '🪝' },
  event: { label: '上游完成', icon: '⛓' },
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    resetForm()
    await load()
  },
)

async function load() {
  loading.value = true
  try {
    const res = await triggerApi.list(props.pipelineId, { page: 1, pageSize: 100 })
    items.value = res.items
  } catch (e) {
    toast.err('触发器列表加载失败：' + readErrorAxios(e).message)
  } finally {
    loading.value = false
  }
}

function resetForm() {
  name.value = ''
  type.value = 'cron'
  enabled.value = true
  cronExpr.value = ''
  cronNext.value = []
  cronErr.value = ''
  onPipelineId.value = ''
  statuses.value = 'Succeeded'
  revealedToken.value = ''
  creating.value = false
}

// cron 表达式输入 → 服务端即时校验 + 未来 5 次预览。
async function previewCron() {
  cronNext.value = []
  cronErr.value = ''
  if (!cronExpr.value.trim()) return
  try {
    const res = await triggerApi.cronPreview(props.pipelineId, cronExpr.value.trim())
    cronNext.value = res.next
  } catch (e) {
    cronErr.value = readErrorAxios(e).message
  }
}

function buildSpec(): TriggerSpec {
  if (type.value === 'cron') return { expr: cronExpr.value.trim() }
  if (type.value === 'event')
    return {
      onPipelineId: onPipelineId.value,
      statuses: statuses.value.split(',').map((s) => s.trim()).filter(Boolean),
    }
  return {}
}

async function submitCreate() {
  saving.value = true
  try {
    const res = await triggerApi.create(props.pipelineId, {
      name: name.value.trim(),
      type: type.value,
      enabled: enabled.value,
      spec: buildSpec(),
    })
    // webhook 签名仅展示一次 —— 拿到就亮出来，用户复制后无法再看。
    revealedToken.value = res.token
    toast.ok('触发器已创建')
    creating.value = false
    resetForm()
    await load()
  } catch (e) {
    toast.err('创建失败：' + readErrorAxios(e).message)
  } finally {
    saving.value = false
  }
}

async function toggle(trig: PipelineTrigger) {
  try {
    await triggerApi.update(props.pipelineId, trig.id, {
      name: trig.name,
      enabled: !trig.enabled,
      spec: trig.spec,
    })
    await load()
  } catch (e) {
    toast.err('启停失败：' + readErrorAxios(e).message)
  }
}

async function rotate(trig: PipelineTrigger) {
  try {
    revealedToken.value = await triggerApi.rotate(props.pipelineId, trig.id)
    await load()
  } catch (e) {
    toast.err('轮换失败：' + readErrorAxios(e).message)
  }
}

async function remove(trig: PipelineTrigger) {
  if (!window.confirm(`删除触发器「${trig.name}」？`)) return
  try {
    await triggerApi.remove(props.pipelineId, trig.id)
    toast.ok('触发器已删除')
    await load()
  } catch (e) {
    toast.err('删除失败：' + readErrorAxios(e).message)
  }
}

function fmtLast(t?: string): string {
  if (!t) return '从未触发'
  return new Date(t).toLocaleString()
}

function fmtNext(t: string): string {
  return new Date(t).toLocaleString()
}
</script>

<template>
  <Modal :open="open" title="触发器" :width="640" @close="emit('close')">
    <!-- 新建 -->
    <div v-if="!creating" class="toolbar-row">
      <button class="btn btn-pearl" @click="creating = true">＋ 新建触发器</button>
    </div>

    <form v-else class="create-form" @submit.prevent="submitCreate">
      <div class="t-row">
        <input v-model="name" class="input t-name" placeholder="触发器名称*" required />
        <select v-model="type" class="select t-type">
          <option value="cron">⏰ 定时</option>
          <option value="webhook">🪝 Webhook</option>
          <option value="event">⛓ 上游完成</option>
        </select>
        <label class="t-enabled"><input v-model="enabled" type="checkbox" /> 启用</label>
      </div>
      <div v-if="type === 'cron'" class="t-spec">
        <div class="t-row">
          <input
            v-model="cronExpr"
            class="input"
            placeholder="cron 表达式：分 时 日 月 周，如 */15 * * * *"
            @blur="previewCron"
          />
          <button type="button" class="btn btn-pearl" @click="previewCron">校验</button>
        </div>
        <div v-if="cronErr" class="t-err">{{ cronErr }}</div>
        <div v-if="cronNext.length" class="t-next">
          <div class="t-next-title">未来 5 次：</div>
          <div v-for="(t, i) in cronNext" :key="i" class="t-next-item mono">{{ fmtNext(t) }}</div>
        </div>
      </div>
      <div v-else-if="type === 'event'" class="t-spec">
        <input v-model="onPipelineId" class="input" placeholder="上游流水线 ID (uuid)*" />
        <input v-model="statuses" class="input" placeholder="触发状态，逗号分隔（默认 Succeeded）" />
      </div>
      <div v-else class="t-spec">
        <div class="hint">创建后生成签名 token（仅展示一次）；外部系统 POST /api/v1/webhooks/pipeline-triggers/:id 携 X-Webhook-Token 触发。</div>
      </div>
      <div class="t-row t-actions">
        <button type="button" class="btn btn-pearl" @click="resetForm">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="saving || !name.trim() || (type === 'cron' && !!cronErr)">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </form>

    <!-- token 一次性展示 -->
    <div v-if="revealedToken" class="token-reveal">
      <b>新签名（仅本次展示，请立即复制）：</b>
      <code class="mono">{{ revealedToken }}</code>
      <button class="link-btn" @click="revealedToken = ''">已复制，关闭</button>
    </div>

    <!-- 列表 -->
    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="items.length === 0" class="empty">
      尚无触发器。手动触发无需配置 —— 此处管理 定时 / Webhook / 上游完成 三类自动触发。
    </div>
    <div v-else class="t-list">
      <div v-for="trig in items" :key="trig.id" class="t-item">
        <span class="t-icon">{{ TYPE_META[trig.type]?.icon ?? '?' }}</span>
        <div class="t-info">
          <div class="t-title">
            <b>{{ trig.name }}</b>
            <span class="t-tag">{{ TYPE_META[trig.type]?.label ?? trig.type }}</span>
            <span v-if="trig.tokenPrefix" class="t-token mono" :title="'签名前缀'">{{ trig.tokenPrefix }}…</span>
          </div>
          <div class="t-sub mono">
            {{ trig.type === 'cron' ? trig.spec?.expr : trig.type === 'event' ? `on ${trig.spec?.onPipelineId?.slice(0, 8)}… [${(trig.spec?.statuses ?? []).join(',')}]` : 'POST + X-Webhook-Token' }}
          </div>
          <div class="t-sub">最近触发：{{ fmtLast(trig.lastTriggeredAt) }}</div>
        </div>
        <div class="t-acts">
          <label class="switch-label">
            <input type="checkbox" :checked="trig.enabled" @change="toggle(trig)" /> {{ trig.enabled ? '启用' : '停用' }}
          </label>
          <button v-if="trig.type === 'webhook'" class="mini" @click="rotate(trig)">轮换签名</button>
          <button class="mini danger" @click="remove(trig)">删除</button>
        </div>
      </div>
    </div>

    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.toolbar-row { margin-bottom: 12px; }
.create-form { border: 1px solid var(--hairline); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
.t-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.t-row .t-name { flex: 1; min-width: 0; }
.t-row .t-type { flex: 0 0 150px; }
.t-enabled { font-size: 12px; color: var(--text-sub); white-space: nowrap; }
.t-spec { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.t-err { color: var(--failed-fg); font-size: 12px; }
.t-next { font-size: 12px; color: var(--text-sub); }
.t-next-title { margin-bottom: 2px; }
.t-actions { justify-content: flex-end; margin-bottom: 0; }
.token-reveal { background: var(--warning-bg); color: var(--warning-fg); border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 12px; }
.token-reveal .mono { display: block; margin: 6px 0; word-break: break-all; }
.empty { color: var(--text-sub); font-size: 13px; padding: 18px 0; text-align: center; }
.t-list { display: flex; flex-direction: column; gap: 8px; }
.t-item { display: flex; align-items: center; gap: 10px; border: 1px solid var(--hairline); border-radius: 10px; padding: 10px 12px; }
.t-icon { font-size: 18px; }
.t-info { flex: 1; min-width: 0; }
.t-title { display: flex; align-items: center; gap: 8px; }
.t-tag { font-size: 11px; border: 1px solid var(--hairline); border-radius: 6px; padding: 0 6px; color: var(--text-sub); }
.t-token { font-size: 11px; color: var(--text-sub); }
.t-sub { font-size: 12px; color: var(--text-sub); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-acts { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.switch-label { font-size: 12px; color: var(--text-sub); display: flex; align-items: center; gap: 4px; }
.mini { font-size: 11px; padding: 3px 7px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--surface); color: var(--text-sub); cursor: pointer; }
.mini.danger:hover { border-color: var(--failed-fg); color: var(--failed-fg); }
</style>
