<script setup lang="ts">
// 流水线版本历史 / 对比 / 回滚（C-09）。
//
// 三条与后端能力严格对齐的约定：
//   ① **判定全在后端**：改没改、哪里改，一律用 hub `.../versions/:v/diff` 的结果，
//      前端不自己比两份快照（§7.4「前端零判断」同理）。
//   ② **回滚是追加语义**：hub 不重写历史，只记一版新的；文案与按钮都不说"恢复历史"。
//   ③ 列表不带快照体（体可能很大）：结构预览按需单取一版。
import { computed, ref, watch } from 'vue'
import Modal from './Modal.vue'
import {
  pipelineApi,
  type PipelineVersionDiff,
  type PipelineVersionSummary,
} from '@/api/pipeline'
import { toast } from '@/utils/toast'
import {
  changeClass,
  changeLabel,
  diffRows,
  identicalMark,
  isNoopRollback,
  readErrorAxios,
  rollbackWarning,
  summarizeDiff,
  versionLabel,
  versionOrigin,
} from '@/utils/pipeline'

const props = defineProps<{
  open: boolean
  pipelineId: string
  /** 流水线当前版本号（来自 GET /pipelines/:id），用于"与当前版对比"与回滚禁用判定。 */
  currentVersion: number
}>()
const emit = defineEmits<{ close: []; 'rolled-back': [] }>()

const versions = ref<PipelineVersionSummary[]>([])
const loading = ref(false)
const loadError = ref('')

// 对比：基准（from）→ 目标（to）。默认"上一版 → 当前版"。
const against = ref<number | null>(null)
const target = ref<number | null>(null)
const diff = ref<PipelineVersionDiff | null>(null)
const diffing = ref(false)

// 结构预览（按需取单版快照）
const previewOf = ref<number | null>(null)
const previewStages = ref<{ name: string; executionMode: string; tasks: number }[]>([])

// 回滚
const rollbackTarget = ref<number | null>(null)
const rolling = ref(false)

const diffRowsComputed = computed(() => (diff.value ? diffRows(diff.value) : []))
const diffHeadline = computed(() => (diff.value ? summarizeDiff(diff.value.summary) : ''))

const options = computed(() =>
  versions.value.map((v) => ({ value: v.version, label: versionLabel(v.version, v.isCurrent) })),
)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    diff.value = null
    previewOf.value = null
    previewStages.value = []
    rollbackTarget.value = null
    await load()
  },
)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    versions.value = await pipelineApi.listVersions(props.pipelineId)
    // 默认对比"上一版 → 最新版"：绝大多数查看都是"最近一次编辑改了什么"。
    const newest = versions.value[0]?.version ?? null
    const older = versions.value[1]?.version ?? null
    target.value = newest
    against.value = older
  } catch (e: unknown) {
    loadError.value = readErrorAxios(e).message
  } finally {
    loading.value = false
  }
}

async function runDiff(from: number | null, to: number | null) {
  if (from === null || to === null) {
    toast.err('请选择要对比的两个版本')
    return
  }
  diffing.value = true
  try {
    diff.value = await pipelineApi.diffVersions(props.pipelineId, to, from)
  } catch (e: unknown) {
    toast.err('对比失败：' + readErrorAxios(e).message)
  } finally {
    diffing.value = false
  }
}

/** 一键"与当前版对比"（把该版作为基准、当前版作为目标）。 */
function compareWithCurrent(v: PipelineVersionSummary) {
  target.value = props.currentVersion
  against.value = v.version
  void runDiff(v.version, props.currentVersion)
}

async function togglePreview(v: PipelineVersionSummary) {
  if (previewOf.value === v.version) {
    previewOf.value = null
    previewStages.value = []
    return
  }
  try {
    const row = await pipelineApi.getVersion(props.pipelineId, v.version)
    previewStages.value = (row.snapshot?.stages ?? []).map((s) => ({
      name: s.name,
      executionMode: s.executionMode,
      tasks: (s.tasks ?? []).length,
    }))
    previewOf.value = v.version
  } catch (e: unknown) {
    toast.err('读取版本失败：' + readErrorAxios(e).message)
  }
}

async function confirmRollback() {
  if (rollbackTarget.value === null) return
  rolling.value = true
  try {
    const res = await pipelineApi.rollbackVersion(props.pipelineId, rollbackTarget.value)
    toast.ok(`已回滚到 v${res.restoredVersion}（记为 v${res.newVersion}）`)
    rollbackTarget.value = null
    emit('rolled-back')
    await load()
  } catch (e: unknown) {
    toast.err('回滚失败：' + readErrorAxios(e).message)
  } finally {
    rolling.value = false
  }
}
</script>

<template>
  <Modal :open="open" title="版本历史" :width="860" @close="emit('close')">
    <div v-if="loading" class="vh-empty">加载中…</div>
    <div v-else-if="loadError" class="vh-empty">读取失败：{{ loadError }}</div>
    <div v-else-if="versions.length === 0" class="vh-empty">
      还没有版本快照。版本在<b>结构性保存</b>时生成 —— 新建 / 修改阶段或子任务后即出现。
    </div>
    <template v-else>
      <!-- 对比选择器 -->
      <div class="vh-cmp">
        <span class="vh-lbl">对比</span>
        <select v-model="against" class="select vh-sel">
          <option :value="null" disabled>基准版本</option>
          <option v-for="o in options" :key="`a-${o.value}`" :value="o.value">{{ o.label }}</option>
        </select>
        <span class="vh-arrow">→</span>
        <select v-model="target" class="select vh-sel">
          <option :value="null" disabled>目标版本</option>
          <option v-for="o in options" :key="`t-${o.value}`" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="btn btn-pearl" :disabled="diffing" @click="runDiff(against, target)">
          {{ diffing ? '对比中…' : '对比' }}
        </button>
      </div>

      <!-- 差异结果 -->
      <div v-if="diff" class="vh-diff">
        <div class="vh-headline">
          v{{ diff.fromVersion }} → v{{ diff.toVersion }}：<b>{{ diffHeadline }}</b>
        </div>
        <div v-if="diff.identical" class="vh-empty">两份定义完全相同。</div>
        <table v-else class="vh-table">
          <thead>
            <tr><th>对象</th><th>变更</th><th>字段</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in diffRowsComputed" :key="i">
              <td>
                <span class="vh-kind">{{ r.kind === 'stage' ? '阶段' : '子任务' }}</span>
                <span v-if="r.stage" class="vh-stage">{{ r.stage }} /</span>
                <b>{{ r.name }}</b>
              </td>
              <td><span class="badge" :class="changeClass(r.change)"><i class="pt"></i>{{ changeLabel(r.change) }}</span></td>
              <td>
                <span v-if="r.fields.length === 0" class="vh-sub">（结构位置变化）</span>
                <div v-for="(f, j) in r.fields" :key="j" class="vh-field">
                  <span class="vh-fname">{{ f.label }}</span>
                  <span class="vh-from">{{ f.from }}</span>
                  <span class="vh-arrow">→</span>
                  <span class="vh-to">{{ f.to }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 版本列表 -->
      <table class="vh-table vh-list">
        <thead>
          <tr><th>版本</th><th>来源</th><th>结构</th><th>操作</th></tr>
        </thead>
        <tbody>
          <template v-for="v in versions" :key="v.version">
            <tr>
              <td>
                <b>{{ versionLabel(v.version, v.isCurrent) }}</b>
                <span v-if="identicalMark(v.identicalToPrevious)" class="vh-sub">{{
                  identicalMark(v.identicalToPrevious)
                }}</span>
              </td>
              <td class="vh-sub">{{ versionOrigin(v.createdBy, v.createdAt) }}</td>
              <td class="vh-sub">{{ v.stages }} 阶段 / {{ v.tasks }} 子任务</td>
              <td class="vh-acts">
                <button class="link" @click="togglePreview(v)">
                  {{ previewOf === v.version ? '收起结构' : '看结构' }}
                </button>
                <button class="link" @click="compareWithCurrent(v)">与当前版对比</button>
                <button
                  class="link danger"
                  :disabled="isNoopRollback(v.version, currentVersion)"
                  :title="isNoopRollback(v.version, currentVersion) ? '该版本就是当前版本' : `回滚到 v${v.version}`"
                  @click="rollbackTarget = v.version"
                >
                  回滚到此版
                </button>
              </td>
            </tr>
            <tr v-if="previewOf === v.version">
              <td colspan="4" class="vh-preview">
                <span v-if="previewStages.length === 0" class="vh-sub">该版本没有阶段。</span>
                <span v-for="(s, i) in previewStages" :key="i" class="vh-chip">
                  {{ i + 1 }}. {{ s.name }}（{{ s.executionMode === 'serial' ? '串行' : '并行' }} ·
                  {{ s.tasks }} 子任务）
                </span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>

    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">关闭</button>
      <button class="btn btn-pearl" :disabled="loading" @click="load">刷新</button>
    </template>
  </Modal>

  <!-- 回滚确认：破坏性操作，必须显式确认并说清影响面 -->
  <Modal
    :open="rollbackTarget !== null"
    :title="`回滚到 v${rollbackTarget}？`"
    @close="rollbackTarget = null"
  >
    <p class="vh-warn">{{ rollbackWarning(rollbackTarget ?? 0) }}</p>
    <p v-if="rollbackTarget !== null && isNoopRollback(rollbackTarget, currentVersion)" class="vh-warn">
      ⚠️ 所选版本就是当前版本 —— 这次回滚不会改变任何结构。
    </p>
    <template #foot>
      <button class="btn btn-pearl" :disabled="rolling" @click="rollbackTarget = null">取消</button>
      <button class="btn btn-danger" :disabled="rolling" @click="confirmRollback">
        {{ rolling ? '回滚中…' : '确认回滚' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.vh-empty { color: var(--text-sub); font-size: 13px; padding: 14px 0; line-height: 1.8; }
.vh-lbl { font-size: 12px; color: var(--text-sub); }
.vh-cmp { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.vh-sel { flex: 0 0 auto; min-width: 130px; }
.vh-arrow { color: var(--text-sub); }
.vh-diff { margin-bottom: 18px; }
.vh-headline { font-size: 13px; margin-bottom: 8px; }
.vh-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.vh-table th {
  text-align: left; font-weight: 600; font-size: 12px; color: var(--text-sub);
  padding: 6px 8px; border-bottom: 1px solid var(--hairline);
}
.vh-table td { padding: 7px 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
.vh-list { margin-top: 6px; }
.vh-kind {
  font-size: 11px; color: var(--text-sub); border: 1px solid var(--hairline);
  border-radius: 5px; padding: 1px 5px; margin-right: 6px;
}
.vh-stage { color: var(--text-sub); margin-right: 3px; }
.vh-sub { color: var(--text-sub); font-size: 11px; margin-left: 6px; }
.vh-field { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.vh-fname { color: var(--text-sub); min-width: 74px; display: inline-block; }
.vh-from { color: var(--failed-fg); text-decoration: line-through; }
.vh-to { color: var(--succeeded-fg); }
.vh-acts { display: flex; gap: 4px; flex-wrap: wrap; }
.vh-preview { display: flex; gap: 10px; flex-wrap: wrap; padding: 8px 8px 10px; }
.vh-chip {
  font-size: 11px; border: 1px solid var(--hairline); border-radius: 6px;
  padding: 2px 7px; color: var(--text-sub);
}
.vh-warn { font-size: 13px; line-height: 1.8; color: var(--text); margin: 0 0 8px; }
.link {
  background: none; border: none; color: var(--text-sub); cursor: pointer;
  font-size: 11px; padding: 0 3px; font-family: var(--font);
}
.link:hover:not(:disabled) { color: var(--accent); }
.link:disabled { opacity: 0.35; cursor: not-allowed; }
.link.danger:hover { color: var(--failed-fg); }
</style>
