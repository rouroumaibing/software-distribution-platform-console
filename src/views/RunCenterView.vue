<script setup lang="ts">
// 运行中心（IA v4.4；URL 形态裁决见 CONSOLE-UI-DESIGN.md 附 B，N-13）。
//
// 两视图共用一条 URL：/runs?view=runs|releases（+ &phase= &page=），
// 因为「运行 / 发布」是同一批数据的两个切面，不是子页面。
// （「流水线」视图已于 v4.4 移除，其列表归属「组件详情 · 交付 · 流水线」。）
//
// 附 B B.6 的 5 条硬约束里，本文件负责 ①②③：
//   ① 缺省归一化 —— view 缺省/非法即 replace 成规范形态，地址栏只有一种形状；
//   ② 面包屑同源 —— 第二段中文名取自 RUN_VIEWS（constants/runCenter.ts），不另建映射表；
//   ③ 历史栈纪律 —— 视图切换 / 筛选 / 分页一律 replace，只有下钻详情才 push。
//
// 数据源（不臆想，按 hub 实际端点）：
//   · 运行视图 → GET /api/v1/runs?page=&pageSize=&phase=（服务端过滤，已存在）
//   · 发布视图 → 仍走 GET /runs 扫描 + 按流水线 kind 前端聚合，见
//     useResourceMap.buildResourceIndex()。hub 侧全局 GET /releases 已存在（附 A N-3），
//     但 console 尚无对应 api 封装 —— 切过去是独立一条待办，不在本轮。
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import { runApi, type PipelineRun } from '@/api/run'
import {
  buildResourceIndex,
  emptyResourceIndex,
  type ResourceIndex,
} from '@/composables/useResourceMap'
import {
  canonicalRunQuery,
  DEFAULT_RUN_VIEW,
  getRunView,
  runQueryParams,
  RUN_VIEWS,
  sameQuery,
  type RunViewKey,
} from '@/constants/runCenter'

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 20
// 发布视图（前端聚合）一次拉取上限：console 侧接上全局 /releases 前的过渡手段。
const AGGREGATE_SCAN = 200

const view = ref<RunViewKey>(DEFAULT_RUN_VIEW)
const phase = ref('')
const page = ref(1)
const total = ref(0)

const runRows = ref<PipelineRun[]>([]) // 运行视图 / 发布视图共用
const truncated = ref(false) // 聚合窗口被截断（共 N 条 > 实际扫描数）
const index = ref<ResourceIndex>(emptyResourceIndex())
const loading = ref(true)

const viewLabel = computed(() => getRunView(view.value).label)
const filters = computed(() => getRunView(view.value).filters)

// ---- 资源索引：全局共用一次（组件名 / 流水线名 / kind 都从这里取）----
let indexPromise: Promise<ResourceIndex> | undefined
function ensureIndex(): Promise<ResourceIndex> {
  indexPromise ??= buildResourceIndex().catch(() => emptyResourceIndex())
  return indexPromise
}

// ---- URL → 状态：唯一的写入口，所有交互都只改地址栏，状态由这里派生 ----
watch(() => route.query, syncRoute, { immediate: true })

async function syncRoute() {
  const q = canonicalRunQuery(route.query)
  if (!sameQuery(runQueryParams(q), currentQuery())) {
    // ① 归一化：/runs → /runs?view=runs；非法 view/phase 直接丢掉。
    // replace 会再次触发本 watcher，数据加载交给规范化后的那一轮。
    await router.replace({ path: '/runs', query: runQueryParams(q) })
    return
  }
  view.value = q.view
  phase.value = q.phase
  page.value = q.page
  await load()
}

function currentQuery(): Record<string, string> {
  const q: Record<string, string> = {}
  for (const [k, val] of Object.entries(route.query)) {
    if (typeof val === 'string') q[k] = val
  }
  return q
}

// ---- 交互 → URL（全部 replace，见约束 ③）----
function setView(v: RunViewKey) {
  if (v === view.value) return
  // 切视图 = 换一批数据，筛选与页码一并回到默认
  void router.replace({ path: '/runs', query: { view: v } })
}

function setPhase(f: string) {
  const q: Record<string, string> = { view: view.value }
  if (f) q.phase = f
  void router.replace({ path: '/runs', query: q })
}

function setPage(p: number) {
  const q: Record<string, string> = { view: view.value }
  if (phase.value) q.phase = phase.value
  if (p > 1) q.page = String(p)
  void router.replace({ path: '/runs', query: q })
}

// ---- 加载 ----
let token = 0

async function load() {
  const t = ++token
  loading.value = true
  // 每轮先复位：截断提示只属于「正在做前端聚合」的那个视图，切视图不能带过去
  truncated.value = false
  try {
    const idx = await ensureIndex()
    if (t !== token) return
    index.value = idx

    if (view.value === 'releases') {
      // 发布 = kind==='release' 的流水线的运行。hub 的 GET /runs 只能按 phase 过滤，
      // 按 kind 过滤只能前端做 —— 所以这里扫描一屏运行再筛（N-3 落地后可换成
      // GET /releases?scope=global）。
      const snap = await runApi
        .listAll({ page: 1, pageSize: AGGREGATE_SCAN, phase: phase.value || undefined })
        .catch(() => undefined)
      if (t !== token) return
      const rel = (snap?.items ?? []).filter((r) => idx.byPipelineId.get(r.pipelineId)?.kind === 'release')
      truncated.value = (snap?.total ?? 0) > (snap?.items.length ?? 0)
      total.value = rel.length
      runRows.value = rel.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
      return
    }

    // 运行视图：phase 下推服务端
    const p = await runApi.listAll({
      page: page.value,
      pageSize: PAGE_SIZE,
      phase: phase.value || undefined,
    })
    if (t !== token) return
    truncated.value = false
    runRows.value = p.items
    total.value = p.total
  } finally {
    if (t === token) loading.value = false
  }
}

// ---- 展示辅助 ----
const ref_ = (r: PipelineRun) => index.value.byPipelineId.get(r.pipelineId)

function fmtDuration(r: PipelineRun) {
  if (!r.startTime) return '—'
  const end = r.completionTime ? new Date(r.completionTime).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - new Date(r.startTime).getTime()) / 1000))
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}

function fmtTime(s?: string) {
  return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—'
}

// ---- 下钻：这里才 push（约束 ③）----
function openRun(r: PipelineRun) {
  router.push(`/pipelines/${r.pipelineId}/runs/${r.id}`)
}

function openRelease(r: PipelineRun) {
  router.push(`/releases/${r.id}?pipelineId=${r.pipelineId}`)
}

function openComponent(componentId: string) {
  router.push(`/components/${componentId}/overview`)
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="crumb">SDP / 运行中心 / <b>{{ viewLabel }}</b></div>
      <h1 class="title">运行中心</h1>
      <div class="sub">跨组件巡视 · 运行 / 发布</div>
    </div>

    <div class="tabs">
      <div
        v-for="v in RUN_VIEWS"
        :key="v.key"
        class="tab"
        :class="{ active: v.key === view }"
        @click="setView(v.key)"
      >{{ v.label }}</div>
    </div>

    <div class="toolbar" style="margin-top: 0">
      <button
        v-for="f in filters"
        :key="f.value"
        class="btn btn-sm"
        :class="phase === f.value ? 'btn-dark' : 'btn-pearl'"
        @click="setPhase(f.value)"
      >{{ f.label }}</button>
      <div class="spacer"></div>
      <span class="sub">
        共 {{ total }} 条<template v-if="truncated">（按最近 {{ AGGREGATE_SCAN }} 条运行聚合，全局聚合端点待补）</template>
      </span>
    </div>

    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>

      <!-- 发布视图 -->
      <div v-else-if="view === 'releases' && runRows.length === 0" class="empty">暂无发布记录（kind=release 的流水线运行）</div>
      <table v-else-if="view === 'releases'" class="table">
        <thead><tr><th>发布</th><th>组件</th><th>环境</th><th>流水线</th><th>状态</th><th>开始时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in runRows" :key="r.id" style="cursor: pointer" @click="openRelease(r)">
            <td class="mono">{{ r.crName || r.id.slice(0, 8) }}</td>
            <td>
              <a v-if="ref_(r)" @click.stop="openComponent(ref_(r)!.componentId)">{{ ref_(r)!.componentName }}</a>
              <span v-else class="mono">{{ r.pipelineId.slice(0, 8) }}</span>
            </td>
            <td class="mono">{{ r.targetId ? r.targetId.slice(0, 8) : '—' }}</td>
            <td>{{ ref_(r)?.pipelineName ?? r.pipelineId.slice(0, 8) }}</td>
            <td><StatusBadge :phase="r.phase" /></td>
            <td class="mono">{{ fmtTime(r.startTime) }}</td>
            <td><a>灰度详情 →</a></td>
          </tr>
        </tbody>
      </table>

      <!-- 运行视图（默认） -->
      <div v-else-if="runRows.length === 0" class="empty">暂无运行记录</div>
      <table v-else class="table">
        <thead><tr><th>状态</th><th>组件</th><th>流水线</th><th>触发人</th><th>开始时间</th><th>耗时</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in runRows" :key="r.id" style="cursor: pointer" @click="openRun(r)">
            <td><StatusBadge :phase="r.phase" /></td>
            <td>
              <a v-if="ref_(r)" @click.stop="openComponent(ref_(r)!.componentId)">{{ ref_(r)!.componentName }}</a>
              <span v-else class="mono">{{ r.pipelineId.slice(0, 8) }}</span>
            </td>
            <td>{{ ref_(r)?.pipelineName ?? r.pipelineId.slice(0, 8) }}</td>
            <td>{{ r.triggeredBy || '—' }}</td>
            <td class="mono">{{ fmtTime(r.startTime) }}</td>
            <td class="mono">{{ fmtDuration(r) }}</td>
            <td><a>监控 →</a></td>
          </tr>
        </tbody>
      </table>
    </div>

    <PaginationBar :total="total" :page="page" :page-size="PAGE_SIZE" @change="setPage" />
  </div>
</template>
