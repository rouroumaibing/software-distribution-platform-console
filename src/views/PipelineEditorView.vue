<script setup lang="ts">
// 流水线编排(CONSOLE-LAYOUT §3.4)：阶段组横向流 + 三态子任务抽屉 + 触发对话框。
// 阶段内任务纵排=串行,阶段间箭头=依赖;DependsOn 并行需求出现后升级画布。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import TaskFormDrawer from '@/components/TaskFormDrawer.vue'
import TriggerRunDialog from '@/components/TriggerRunDialog.vue'
import {
  pipelineApi,
  type Pipeline,
  type PipelineStage,
  type PipelineTaskTemplate,
} from '@/api/pipeline'
import { toast } from '@/utils/toast'

const route = useRoute()
const router = useRouter()
const pipelineId = route.params.id as string

const pipeline = ref<Pipeline>()
const stages = ref<PipelineStage[]>([])
const tasksByStage = ref<Record<string, PipelineTaskTemplate[]>>({})
const loading = ref(true)

// 抽屉/弹窗状态
const taskDrawer = ref(false)
const editingTask = ref<PipelineTaskTemplate | null>(null)
const activeStageId = ref('')
const triggerDialog = ref(false)
const stageModal = ref(false)
const stageName = ref('')

onMounted(load)

async function load() {
  loading.value = true
  try {
    const list = await pipelineApi.listStages(pipelineId)
    stages.value = [...list].sort((a, b) => a.sequence - b.sequence)
    const map: Record<string, PipelineTaskTemplate[]> = {}
    for (const s of stages.value) {
      const tasks = await pipelineApi.listTasks(s.id)
      map[s.id] = [...tasks].sort((a, b) => a.displayOrder - b.displayOrder)
    }
    tasksByStage.value = map
  } finally {
    loading.value = false
  }
}

const componentId = computed(() => pipeline.value?.componentId)

// pipeline 无单查端点(CONSOLE-MODULES §6):从任务所在 stage 反查不到时仅展示 id。
onMounted(async () => {
  // 尝试从路由 query 带过来的组件上下文补全头部信息;拿不到则省略。
  const cid = route.query.componentId as string
  if (cid) {
    const p = await pipelineApi.listByComponent(cid, { page: 1, pageSize: 100 })
    pipeline.value = p.items.find((x) => x.id === pipelineId)
  }
})

function circled(i: number): string {
  const chars = '①②③④⑤⑥⑦⑧⑨⑩'
  return chars[i] ?? `${i + 1}.`
}

function taskSummary(t: PipelineTaskTemplate): string {
  if (t.type === 'Build') {
    const cmd = [...(t.command ?? []), ...(t.args ?? [])].join(' ')
    return cmd || (t.scriptPath ? `sh ${t.scriptPath}` : '（未配置命令）')
  }
  if (t.type === 'Release') {
    const c = t.releaseConfig?.chart
    if (t.releaseConfig?.manifest) return 'kubectl apply'
    return c?.chartUrl || [c?.repo, c?.name, c?.version].filter(Boolean).join(' / ') || 'helm upgrade'
  }
  return 'approval'
}

function typeIcon(t: PipelineTaskTemplate): string {
  return t.type === 'Build' ? '⌘' : t.type === 'Release' ? '⬇' : '✓'
}

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
  await pipelineApi.deleteTask(t.id)
  toast.ok('子任务已删除')
  await load()
}

async function addStage() {
  if (!stageName.value.trim()) {
    toast.err('请填写阶段名称')
    return
  }
  await pipelineApi.createStage(pipelineId, {
    name: stageName.value.trim(),
    sequence: stages.value.length + 1,
  })
  toast.ok('阶段已创建')
  stageModal.value = false
  stageName.value = ''
  await load()
}

async function removeStage(s: PipelineStage) {
  await pipelineApi.deleteStage(s.id)
  toast.ok('阶段已删除')
  await load()
}
</script>

<template>
  <div>
    <div v-if="loading" class="loading">加载中…</div>
    <template v-else>
      <div class="page-head">
        <div class="crumb">流水线 / <b>{{ pipeline?.name ?? pipelineId.slice(0, 8) }}</b></div>
        <h1 class="title">{{ pipeline?.name ?? '流水线编排' }}</h1>
        <div class="sub">{{ stages.length }} 阶段 · {{ Object.values(tasksByStage).flat().length }} 子任务</div>
        <div class="toolbar">
          <button class="btn btn-pearl" @click="stageModal = true">＋ 新建阶段</button>
          <div class="spacer"></div>
          <button class="btn btn-pearl" @click="router.push(`/pipelines/${pipelineId}/runs`)">运行历史</button>
          <button class="btn btn-dark" @click="triggerDialog = true">▶ 触发运行</button>
        </div>
      </div>

      <!-- 阶段组横向流 -->
      <div v-if="stages.length === 0" class="card"><div class="empty">还没有阶段。点击「＋ 新建阶段」开始编排。</div></div>
      <div v-else class="flow">
        <template v-for="(s, i) in stages" :key="s.id">
          <div class="stage card">
            <div class="shead">
              <span class="sname">{{ circled(i) }} {{ s.name }}</span>
              <a class="del" title="删除阶段" @click="removeStage(s)">×</a>
            </div>
            <div
              v-for="t in tasksByStage[s.id] ?? []"
              :key="t.id"
              class="task-row"
              @click="openEditTask(t)"
            >
              <span class="ticon" :class="'ti-' + t.type.toLowerCase()">{{ typeIcon(t) }}</span>
              <span class="tname">{{ t.name }}</span>
              <span class="tcmd mono">{{ taskSummary(t) }}</span>
              <a class="tdel" title="删除" @click.stop="removeTask(t)">×</a>
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
  </div>
</template>

<style scoped>
.flow { display: flex; align-items: flex-start; gap: 0; overflow-x: auto; padding-bottom: 8px; }
.stage { flex: 0 0 300px; }
.shead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sname { font-weight: 600; font-size: 15px; }
.del { color: var(--sub); cursor: pointer; font-size: 16px; }
.del:hover { color: var(--failed-fg); }
.task-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--hairline); border-radius: 8px; margin-bottom: 8px;
  cursor: pointer; background: #fff; font-size: 13px; transition: 0.15s;
}
.task-row:hover { border-color: var(--action-blue); }
.ticon {
  width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center;
  font-size: 13px; color: #fff; flex: 0 0 auto;
}
.ti-build { background: #0066cc; }
.ti-release { background: #1e8e3e; }
.ti-approval { background: #9334e6; }
.tname { font-weight: 500; white-space: nowrap; }
.tcmd { color: var(--sub); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tdel { color: var(--sub); cursor: pointer; }
.tdel:hover { color: var(--failed-fg); }
.add-task {
  width: 100%; padding: 8px; border: 1px dashed var(--hairline); border-radius: 8px;
  background: none; color: var(--sub); cursor: pointer; font-size: 13px; font-family: var(--font);
}
.add-task:hover { border-color: var(--action-blue); color: var(--action-blue); }
.arrow {
  flex: 0 0 40px; display: flex; align-items: center; justify-content: center;
  color: var(--sub); font-size: 18px; padding-top: 120px;
}
</style>
