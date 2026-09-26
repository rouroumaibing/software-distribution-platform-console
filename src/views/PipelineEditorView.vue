<script setup lang="ts">
// 流水线编排（§7.4 / §6.0）：阶段组横向流 + 派生产品语言的子任务抽屉 + 触发对话框。
//
// 三条落地约定（都与后端实际能力对齐，不做"装饰控件"）：
//   ① 头部元信息走 `GET /pipelines/:id` 直取 —— 早前靠 `?componentId=` 反查列表的老
//      hack 已删 —— 该端点一直存在，早前那段注释把结论写错了。
//   ② 结构性增删（建/删阶段、建/删/改子任务）**即时落库**：它们各自只对应一个已存在的
//      端点，且新建后需要服务端下发的 id。
//   ③ `[保存]` 冲刷三类**局部**改动：元信息、阶段 sequence+executionMode、子任务
//      displayOrder。先弹「请求体预览」（JSON / YAML 双视图 + 实际调用序列）再发送。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import PipelineVersionPanel from '@/components/PipelineVersionPanel.vue'
import TaskFormDrawer from '@/components/TaskFormDrawer.vue'
import TriggerRunDialog from '@/components/TriggerRunDialog.vue'
import {
  pipelineApi,
  type Pipeline,
  type PipelineStage,
  type PipelineTaskTemplate,
} from '@/api/pipeline'
import { toast } from '@/utils/toast'
import {
  buildPipelineRequest,
  circled,
  executionModeLabel,
  expandPipelineCalls,
  isDeleteConfirmed,
  isStageExecutionMode,
  moveChanged,
  moveItem,
  natureFromTaskType,
  nextExecutionMode,
  objToYaml,
  readDeleteVerdict,
  readErrorAxios,
  taskTypeClass,
  taskTypeIcon,
  type DeleteVerdict,
  type PipelineRequestBody,
  type StageExecutionMode,
} from '@/utils/pipeline'

const route = useRoute()
const router = useRouter()
const pipelineId = route.params.id as string

const pipeline = ref<Pipeline>()
const stages = ref<PipelineStage[]>([])
const tasksByStage = ref<Record<string, PipelineTaskTemplate[]>>({})
const loading = ref(true)
/** 有未保存的局部改动（元信息 / 顺序 / executionMode）。 */
const dirty = ref(false)

// 头部元信息草稿（[保存] 才落库）。kind 必须窄化为 Pipeline['kind'] ——
// 否则 ref 推断成 string，绑到 <select v-model> 上 TS2322。
const meta = ref<{ name: string; kind: Pipeline['kind']; description: string }>({
  name: '',
  kind: 'build',
  description: '',
})

// 抽屉 / 弹窗状态
const taskDrawer = ref(false)
const editingTask = ref<PipelineTaskTemplate | null>(null)
const activeStageId = ref('')
const triggerDialog = ref(false)
const stageModal = ref(false)
const stageName = ref('')
const metaOpen = ref(false)
/** 版本历史面板（C-09）。 */
const versionOpen = ref(false)

onMounted(load)

async function load() {
  loading.value = true
  try {
    // ① 直取单条（不再从组件列表里 find）
    const p = await pipelineApi.get(pipelineId)
    pipeline.value = p
    meta.value = { name: p.name, kind: p.kind, description: p.description ?? '' }

    const list = await pipelineApi.listStages(pipelineId)
    stages.value = [...list].sort((a, b) => a.sequence - b.sequence)
    const map: Record<string, PipelineTaskTemplate[]> = {}
    for (const s of stages.value) {
      const tasks = await pipelineApi.listTasks(s.id)
      map[s.id] = [...tasks].sort((a, b) => a.displayOrder - b.displayOrder)
    }
    tasksByStage.value = map
    dirty.value = false
  } finally {
    loading.value = false
  }
}

const componentId = computed(() => pipeline.value?.componentId)

/** 防御：老数据 / 半写状态下 executionMode 可能为空，一律按默认 parallel 展示。 */
function modeOf(s: PipelineStage): StageExecutionMode {
  return isStageExecutionMode(s.executionMode) ? s.executionMode : 'parallel'
}

function taskSummary(t: PipelineTaskTemplate): string {
  if (t.type === 'Build') {
    const cmd = [...(t.command ?? []), ...(t.args ?? [])].join(' ')
    return cmd || (t.scriptPath ? `sh ${t.scriptPath}` : '（未配置命令）')
  }
  if (t.type === 'Release') {
    const c = t.releaseConfig?.chart
    if (t.releaseConfig?.manifest?.content) return 'kubectl apply'
    return [c?.repoURL, c?.name, c?.version].filter(Boolean).join(' / ') || 'helm upgrade'
  }
  return 'approval'
}

// ---------------------------------------------------------------------------
// 重排 / 模式切换（局部草稿 → [保存] 落库）
// ---------------------------------------------------------------------------

function moveStage(i: number, dir: 'up' | 'down') {
  if (!moveChanged(stages.value, i, dir)) return
  stages.value = moveItem(stages.value, i, dir)
  dirty.value = true
}

function moveTask(stageId: string, i: number, dir: 'up' | 'down') {
  const arr = tasksByStage.value[stageId] ?? []
  if (!moveChanged(arr, i, dir)) return
  tasksByStage.value = { ...tasksByStage.value, [stageId]: moveItem(arr, i, dir) }
  dirty.value = true
}

function toggleMode(s: PipelineStage) {
  const next = nextExecutionMode(modeOf(s))
  const idx = stages.value.findIndex((x) => x.id === s.id)
  if (idx < 0) return
  stages.value = stages.value.map((x, i) => (i === idx ? { ...x, executionMode: next } : x))
  dirty.value = true
}

function renameStage(s: PipelineStage, name: string) {
  const idx = stages.value.findIndex((x) => x.id === s.id)
  if (idx < 0) return
  stages.value = stages.value.map((x, i) => (i === idx ? { ...x, name } : x))
  dirty.value = true
}

// ---------------------------------------------------------------------------
// 结构性增删（即时落库）
// ---------------------------------------------------------------------------

function openCreateTask(stageId: string) {
  activeStageId.value = stageId
  editingTask.value = null
  taskDrawer.value = true
}

function openEditTask(t: PipelineTaskTemplate) {
  activeStageId.value = t.stageId
  editingTask.value = t
  taskDrawer.value = true
}

async function removeTask(t: PipelineTaskTemplate) {
  try {
    await pipelineApi.deleteTask(t.id)
    toast.ok('子任务已删除')
    await load()
  } catch (e: unknown) {
    toast.err('删除失败：' + readErrorAxios(e).message)
  }
}

async function addStage() {
  if (!stageName.value.trim()) {
    toast.err('请填写阶段名称')
    return
  }
  try {
    await pipelineApi.createStage(pipelineId, {
      name: stageName.value.trim(),
      sequence: stages.value.length + 1,
      executionMode: 'parallel',
    })
    toast.ok('阶段已创建')
    stageModal.value = false
    stageName.value = ''
    await load()
  } catch (e: unknown) {
    toast.err('创建失败：' + readErrorAxios(e).message)
  }
}

async function removeStage(s: PipelineStage) {
  try {
    await pipelineApi.deleteStage(s.id)
    toast.ok('阶段已删除')
    await load()
  } catch (e: unknown) {
    toast.err('删除失败：' + readErrorAxios(e).message)
  }
}

// ---------------------------------------------------------------------------
// [保存]：请求体预览 → 确认 → 冲刷三类局部改动
// ---------------------------------------------------------------------------

const previewOpen = ref(false)
const previewFmt = ref<'json' | 'yaml'>('json')
const saving = ref(false)

const requestBody = computed<PipelineRequestBody>(() => ({
  componentId: pipeline.value?.componentId ?? '',
  name: meta.value.name.trim(),
  kind: meta.value.kind,
  description: meta.value.description.trim() || undefined,
  stages: stages.value.map((s, i) => ({
    name: s.name,
    sequence: i + 1,
    executionMode: modeOf(s),
    tasks: (tasksByStage.value[s.id] ?? []).map((t, j) => ({
      type: t.type,
      name: t.name,
      displayOrder: j + 1,
      ...(t.image ? { image: t.image } : {}),
      ...(t.command?.length ? { command: t.command } : {}),
      ...(t.args?.length ? { args: t.args } : {}),
      ...(t.timeoutSeconds ? { timeoutSeconds: t.timeoutSeconds } : {}),
    })),
  })),
}))

// 附 D.4：body 是**产品视图**；hub 无整 DAG 端点。
const preview = computed(() => buildPipelineRequest(pipelineId, requestBody.value))
const previewJson = computed(() => JSON.stringify(preview.value.body, null, 2))
const previewYaml = computed(() => objToYaml(preview.value.body).replace(/\n+$/, ''))
const previewCalls = computed(() =>
  expandPipelineCalls(
    pipelineId,
    requestBody.value,
    stages.value.map((s) => s.id),
  ),
)

function openPreview() {
  previewFmt.value = 'json'
  previewOpen.value = true
}

async function commitSave() {
  saving.value = true
  try {
    // ① 元信息
    await pipelineApi.update(pipelineId, {
      name: meta.value.name.trim(),
      kind: meta.value.kind,
      description: meta.value.description.trim(),
    })
    // ② 阶段：sequence + executionMode
    for (let i = 0; i < stages.value.length; i++) {
      const s = stages.value[i] as PipelineStage
      await pipelineApi.updateStage(s.id, { sequence: i + 1, executionMode: modeOf(s) })
      // ③ 子任务：displayOrder
      const tasks = tasksByStage.value[s.id] ?? []
      for (let j = 0; j < tasks.length; j++) {
        const t = tasks[j] as PipelineTaskTemplate
        if (t.displayOrder !== j + 1) await pipelineApi.updateTask(t.id, { displayOrder: j + 1 })
      }
    }
    toast.ok('流水线已保存')
    previewOpen.value = false
    await load()
  } catch (e: unknown) {
    toast.err('保存失败：' + readErrorAxios(e).message)
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// 删除（§7.4：强确认 → DELETE → 渲染后端 verdict；前端零判断）
// ---------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteConfirmText = ref('')
const deleting = ref(false)
const verdict = ref<DeleteVerdict | null>(null)

const canDelete = computed(() => isDeleteConfirmed(deleteConfirmText.value, meta.value.name))

function openDelete() {
  deleteConfirmText.value = ''
  verdict.value = null
  deleteOpen.value = true
}

async function submitDelete() {
  if (!canDelete.value) return
  deleting.value = true
  try {
    await pipelineApi.remove(pipelineId)
    toast.ok(`流水线「${meta.value.name}」已删除（历史运行日志保留）`)
    deleteOpen.value = false
    router.push(`/components/${componentId.value ?? ''}?tab=pipelines`)
  } catch (e: unknown) {
    const { status, body } = readErrorAxios(e)
    const v = readDeleteVerdict(status, body)
    if (v.blocked) {
      deleteOpen.value = false
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
    <div v-if="loading" class="loading">加载中…</div>
    <template v-else>
      <div class="page-head">
        <div class="crumb">流水线 / <b>{{ meta.name || pipelineId.slice(0, 8) }}</b></div>
        <h1 class="title">{{ meta.name || '流水线编排' }}</h1>
        <div class="sub">
          {{ stages.length }} 阶段 · {{ Object.values(tasksByStage).flat().length }} 子任务
          <span v-if="pipeline">· v{{ pipeline.version }}</span>
          <span v-if="dirty" class="dirty">· 有未保存改动</span>
        </div>
        <div class="toolbar">
          <button class="btn btn-pearl" @click="stageModal = true">＋ 新建阶段</button>
          <button class="btn btn-pearl" @click="metaOpen = true">编辑信息</button>
          <button class="btn btn-pearl" @click="versionOpen = true">版本历史</button>
          <div class="spacer"></div>
          <button class="btn btn-pearl" @click="router.push(`/pipelines/${pipelineId}/runs`)">
            运行历史
          </button>
          <button class="btn btn-dark" @click="openPreview">保存</button>
          <button class="btn btn-dark" @click="triggerDialog = true">▶ 触发运行</button>
          <button class="btn btn-danger" @click="openDelete">🗑 删除流水线</button>
        </div>
      </div>

      <!-- 阶段组横向流 -->
      <div v-if="stages.length === 0" class="card">
        <div class="empty">还没有阶段。点击「＋ 新建阶段」开始编排。</div>
      </div>
      <div v-else class="flow">
        <template v-for="(s, i) in stages" :key="s.id">
          <div class="stage card">
            <div class="shead">
              <span class="sno">{{ circled(i) }}</span>
              <input
                class="stage-name-input"
                :value="s.name"
                @change="renameStage(s, ($event.target as HTMLInputElement).value)"
              />
              <div class="sacts">
                <button
                  class="mini"
                  :title="`切换并行 / 串行（executionMode）；当前 ${executionModeLabel(modeOf(s))}`"
                  @click="toggleMode(s)"
                >
                  {{ executionModeLabel(modeOf(s)) }}
                </button>
                <button class="mini" :disabled="i === 0" title="阶段前移" @click="moveStage(i, 'up')">
                  ◀
                </button>
                <button
                  class="mini"
                  :disabled="i === stages.length - 1"
                  title="阶段后移"
                  @click="moveStage(i, 'down')"
                >
                  ▶
                </button>
                <button class="mini danger" title="删除阶段" @click="removeStage(s)">✕</button>
              </div>
            </div>

            <div
              v-for="(t, j) in tasksByStage[s.id] ?? []"
              :key="t.id"
              class="task-row"
              @click="openEditTask(t)"
            >
              <span
                class="ticon"
                :class="taskTypeClass(t.type)"
                :title="natureFromTaskType(t.type)"
              >{{ taskTypeIcon(t.type) }}</span>
              <span class="tname">{{ t.name }}</span>
              <span class="tcmd mono">{{ taskSummary(t) }}</span>
              <span class="tacts">
                <button class="link" :disabled="j === 0" title="上移" @click.stop="moveTask(s.id, j, 'up')">
                  ▲
                </button>
                <button
                  class="link"
                  :disabled="j === (tasksByStage[s.id] ?? []).length - 1"
                  title="下移"
                  @click.stop="moveTask(s.id, j, 'down')"
                >
                  ▼
                </button>
                <button class="link" title="编辑" @click.stop="openEditTask(t)">编辑</button>
                <button class="link danger" title="删除" @click.stop="removeTask(t)">✕</button>
              </span>
            </div>
            <button class="add-task" @click="openCreateTask(s.id)">＋ 子任务</button>
          </div>
          <div v-if="i < stages.length - 1" class="arrow">→</div>
        </template>
      </div>
    </template>

    <TaskFormDrawer
      :open="taskDrawer"
      :stage-id="activeStageId"
      :task="editingTask"
      @close="taskDrawer = false"
      @saved="load"
    />
    <TriggerRunDialog
      :open="triggerDialog"
      :pipeline-id="pipelineId"
      :component-id="componentId"
      @close="triggerDialog = false"
      @triggered="(r) => router.push(`/pipelines/${pipelineId}/runs/${r.id}`)"
    />

    <!-- 版本历史 / 对比 / 回滚（C-09）。回滚后重新拉取定义 —— 阶段与子任务的行
         id 全变了，沿用旧数组会让后续编辑打到已软删的行上。 -->
    <PipelineVersionPanel
      :open="versionOpen"
      :pipeline-id="pipelineId"
      :current-version="pipeline?.version ?? 0"
      @close="versionOpen = false"
      @rolled-back="load"
    />

    <!-- 新建阶段 -->
    <Modal :open="stageModal" title="新建阶段" @close="stageModal = false">
      <div class="field">
        <label>阶段名称</label>
        <input v-model="stageName" class="input" placeholder="如 构建 / 测试 / 发布" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="stageModal = false">取消</button>
        <button class="btn btn-primary" @click="addStage">创建</button>
      </template>
    </Modal>

    <!-- 编辑元信息 -->
    <Modal :open="metaOpen" title="编辑流水线信息" @close="metaOpen = false">
      <div class="field">
        <label>名称</label>
        <input v-model="meta.name" class="input" />
      </div>
      <div class="field">
        <label>类型</label>
        <select v-model="meta.kind" class="select">
          <option value="build">构建</option>
          <option value="release">发布</option>
          <option value="custom">自定义</option>
        </select>
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="meta.description" class="input" placeholder="可选" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="metaOpen = false">关闭</button>
        <button class="btn btn-primary" @click="metaOpen = false; openPreview()">去保存</button>
      </template>
    </Modal>

    <!-- 保存：请求体预览（JSON / YAML 双视图 + 实际调用序列） -->
    <Modal :open="previewOpen" title="流水线请求体" :width="720" @close="previewOpen = false">
      <div class="req-head">
        <span class="chip mono">{{ preview.method }}</span>
        <b class="mono">{{ preview.url }}</b>
      </div>
      <p class="req-note">
        ⚠️ 下面是**产品视图**的编排体（附 D.4）。hub 的
        <span class="mono">POST /pipelines</span> 是扁平创建、阶段 / 任务经级联端点落库，
        <b>没有「整 DAG 一次提交」端点</b> —— 实际由 console 展开为多次调用：
      </p>
      <pre class="code-block mono">{{ previewCalls.join('\n') }}</pre>
      <div class="seg">
        <button class="seg-btn" :class="{ on: previewFmt === 'json' }" @click="previewFmt = 'json'">
          JSON
        </button>
        <button class="seg-btn" :class="{ on: previewFmt === 'yaml' }" @click="previewFmt = 'yaml'">
          YAML
        </button>
      </div>
      <pre class="code-block mono">{{ previewFmt === 'json' ? previewJson : previewYaml }}</pre>
      <template #foot>
        <button class="btn btn-pearl" @click="previewOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="commitSave">
          {{ saving ? '保存中…' : '确认保存' }}
        </button>
      </template>
    </Modal>

    <!-- 删除强确认 -->
    <Modal
      :open="deleteOpen"
      :title="`删除流水线 ${meta.name}？`"
      @close="deleteOpen = false"
    >
      <p class="req-note">
        此操作不可撤销。若仍有<b>进行中</b>或<b>待审批</b>的运行，后端将拒绝删除并列出原因。
      </p>
      <div class="field">
        <label>请输入流水线名称以确认</label>
        <input v-model="deleteConfirmText" class="input mono" :placeholder="meta.name" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="deleteOpen = false">取消</button>
        <button class="btn btn-danger" :disabled="!canDelete || deleting" @click="submitDelete">
          {{ deleting ? '删除中…' : '删除' }}
        </button>
      </template>
    </Modal>

    <!-- 后端 verdict：无法删除 -->
    <Modal :open="!!verdict" title="无法删除" @close="verdict = null">
      <p class="req-note">{{ verdict?.message }}</p>
      <ul v-if="verdict?.reasons.length" class="reasons">
        <li v-for="(r, i) in verdict.reasons" :key="i">{{ r }}</li>
      </ul>
      <template #foot>
        <button class="btn btn-pearl" @click="verdict = null">知道了</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.dirty { color: var(--warning-fg); font-weight: 600; }
.flow { display: flex; align-items: flex-start; gap: 0; overflow-x: auto; padding-bottom: 8px; }
.stage { flex: 0 0 320px; }
.shead { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.sno { font-weight: 600; color: var(--text-sub); flex: 0 0 auto; }
.stage-name-input {
  flex: 1; min-width: 0; font-weight: 600; font-size: 14px; font-family: var(--font);
  border: 1px solid transparent; background: none; color: var(--text);
  padding: 3px 6px; border-radius: 6px;
}
.stage-name-input:hover { border-color: var(--hairline); }
.stage-name-input:focus { border-color: var(--accent); outline: none; background: var(--surface); }
.sacts { display: flex; gap: 4px; flex: 0 0 auto; }
.mini {
  font-size: 11px; padding: 3px 7px; border: 1px solid var(--hairline); border-radius: 6px;
  background: var(--surface); color: var(--text-sub); cursor: pointer; font-family: var(--font);
}
.mini:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini:disabled { opacity: 0.4; cursor: not-allowed; }
.mini.danger:hover { border-color: var(--failed-fg); color: var(--failed-fg); }
.task-row {
  display: flex; align-items: center; gap: 8px; padding: 9px 11px;
  border: 1px solid var(--hairline); border-radius: 8px; margin-bottom: 8px;
  cursor: pointer; background: var(--surface); font-size: 13px; transition: 0.15s;
}
.task-row:hover { border-color: var(--accent); }
.ticon {
  width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center;
  font-size: 12px; color: #fff; flex: 0 0 auto;
}
.ti-build { background: var(--accent); }
.ti-release { background: var(--succeeded-fg); }
/* Approval 的紫色在双主题下都够亮，且没有对应语义令牌 —— 保留字面量并在此说明，
   免得下次"颜色扫描"把它误判成漏改。 */
.ti-approval { background: #9334e6; }
.tname { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 86px; }
.tcmd { color: var(--text-sub); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tacts { display: flex; gap: 2px; flex: 0 0 auto; }
.link {
  background: none; border: none; color: var(--text-sub); cursor: pointer;
  font-size: 11px; padding: 0 3px; font-family: var(--font);
}
.link:hover:not(:disabled) { color: var(--accent); }
.link:disabled { opacity: 0.35; cursor: not-allowed; }
.link.danger:hover { color: var(--failed-fg); }
.add-task {
  width: 100%; padding: 8px; border: 1px dashed var(--hairline); border-radius: 8px;
  background: none; color: var(--text-sub); cursor: pointer; font-size: 13px; font-family: var(--font);
}
.add-task:hover { border-color: var(--accent); color: var(--accent); }
.arrow {
  flex: 0 0 40px; display: flex; align-items: center; justify-content: center;
  color: var(--text-sub); font-size: 18px; padding-top: 120px;
}
.req-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.req-note { font-size: 12px; color: var(--text-sub); line-height: 1.7; margin: 0 0 10px; }
.code-block {
  background: var(--term-bg); color: var(--term-fg); padding: 12px; border-radius: 8px;
  font-size: 12px; line-height: 1.6; overflow: auto; max-height: 240px; margin: 0 0 12px;
  white-space: pre;
}
.seg { display: flex; gap: 8px; margin-bottom: 10px; }
.seg-btn {
  flex: 0 0 auto; padding: 5px 14px; border: 1px solid var(--hairline);
  background: var(--surface); border-radius: 8px; cursor: pointer; font-size: 12px;
  font-weight: 600; color: var(--text-sub); font-family: var(--font);
}
.seg-btn.on { border-color: var(--accent); background: var(--action-blue-soft); color: var(--accent); }
.reasons { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.9; }
</style>
