<script setup lang="ts">
// 服务树页（CONSOLE-UI-DESIGN.md §3.2 master-detail + §4.1 R-8 规模化）：
// 页内树面板 + 右侧详情。层级：Org → Service → Component。
//
// R-8 落地的四件事：
//   1) **懒加载** —— 展开才请求：挂载时只拉组织（1 次），选中组织才拉它的服务
//      （`GET /orgs/:id/services`，附 A N-9 的新端点），展开服务才拉组件
//      （`GET /services/:id/components`）。改动前是"一次拉全树"：组织 1 次 +
//      服务列表 1 次 + **每个服务各 1 次**组件列表。
//   2) **服务端搜索** —— 输入即查 `GET /search`（附 A N-8），结果行带所属路径，
//      **不需要展开树**。这是与"在已加载节点里 filter"的本质区别：后者搜不到
//      还没展开的深层节点。
//   3) **虚拟滚动** —— 可见行 ≥200 时只渲染窗口内的行（行高常量与窗口计算同源，
//      见 utils/tree.ts，避免 CSS 与 JS 各写一个高度导致错位）。
//   4) **独立滚动容器** —— 树面板自身滚动，页面不随树变长（§4.1）。
//
// 创建主干（沿用原有"树+节点添加对话框"模式）：无组织 → 创建组织（自动 1:1 服务树）；
// 选中组织 → 添加服务；选中服务 → 添加组件。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import { orgApi, type Org } from '@/api/org'
import { catalogApi, type Service } from '@/api/catalog'
import { componentApi, type Component } from '@/api/component'
import { searchApi } from '@/api/search'
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_KIND_LABEL,
  SEARCH_LIMIT,
  moveIndex,
  searchHitRoute,
  type SearchHit,
} from '@/utils/search'
import {
  TREE_ROW_HEIGHT,
  computeWindow,
  ensureVisible,
  expandAction,
  flattenVisible,
  lazyHintLabel,
  shouldVirtualize,
  type LazyState,
  type TreeRowLike,
} from '@/utils/tree'
import { toast } from '@/utils/toast'

const route = useRoute()
const router = useRouter()

/** 单层拉取上限。超过时行尾显示「已加载 N/M」——不静默截断。 */
const PAGE = { page: 1, pageSize: 100 }

interface TreeNode extends TreeRowLike {
  id: string
  name: string
  kind: 'org' | 'service' | 'component'
  state: LazyState
  children: TreeNode[]
  /** 折叠后记住的已知子节点数：懒加载下"提前知道 N"的唯一合法来源。 */
  knownCount?: number
  /** 服务端报告的**总**条数。大于 children.length 说明被 PAGE 上限截断。 */
  total?: number
  error?: string
  service?: Service
  component?: Component
}

const orgs = ref<Org[]>([])
const orgId = ref('')
const roots = ref<TreeNode[]>([])
const loading = ref(false)
const loadError = ref('')
const selected = ref<TreeNode>()

// ---- 服务端搜索状态 ----
const query = ref('')
const hits = ref<SearchHit[]>([])
const searching = ref(false)
const searchError = ref('')

// ---- 滚动 / 虚拟窗口 ----
const scrollEl = ref<HTMLElement>()
const scrollTop = ref(0)
const viewportHeight = ref(0)
let resizeObserver: ResizeObserver | undefined

// ---- 创建对话框状态 ----
const orgDialog = ref(false)
const orgCreating = ref(false)
const orgForm = ref({ name: '', slug: '' })

const serviceDialog = ref(false)
const serviceCreating = ref(false)
const serviceForm = ref({ key: '', name: '', ownerTeam: '', description: '' })
/** 懒取的服务树 id（只在点「＋ 添加服务」时请求，不进主路径）。 */
const serviceTreeId = ref('')

const compDialog = ref(false)
const compCreating = ref(false)
const compForm = ref({ key: '', name: '', repoUrl: '', defaultBranch: 'main', language: '', description: '' })

const selectedId = computed(() => selected.value?.id ?? '')

// ---------------------------------------------------------------------------
// 树渲染：扁平化 → 虚拟窗口
// ---------------------------------------------------------------------------
const flat = computed(() => flattenVisible(roots.value))
const totalHeight = computed(() => flat.value.length * TREE_ROW_HEIGHT)
const virtualized = computed(() => shouldVirtualize(flat.value.length))
const win = computed(() =>
  computeWindow(scrollTop.value, flat.value.length, { viewportHeight: viewportHeight.value }),
)
/** 窗口化时只渲染 `[start,end)`；否则全渲染（小树没必要付切片的代价）。 */
const rowsToRender = computed(() =>
  virtualized.value ? flat.value.slice(win.value.start, win.value.end) : flat.value,
)

// ---------------------------------------------------------------------------
// 加载（懒加载：每次展开都是一次请求，且是唯一来源）
// ---------------------------------------------------------------------------
function errText(e: any): string {
  return e?.response?.data?.error ?? e?.message ?? '未知错误'
}

function toServiceNode(s: Service): TreeNode {
  return { id: s.id, name: s.name, kind: 'service', state: 'collapsed', children: [], service: s }
}

/** 只拉组织。**不**顺带拉服务/组件 —— 那是展开时才做的事。 */
async function loadOrgs() {
  const p = await orgApi.list({ page: 1, pageSize: 100 })
  orgs.value = p.items
  roots.value = orgs.value.map((o) => ({
    id: o.id,
    name: o.name,
    kind: 'org' as const,
    state: 'collapsed' as const,
    children: [] as TreeNode[],
  }))
}

/** 展开一个节点（load / retry / collapse 的规则由 utils/tree.expandAction 定）。 */
async function toggleNode(node: TreeNode) {
  // 组件是叶子：没有子层可加载，也**不能折叠** —— 折叠会让它从列表里消失。
  if (node.kind === 'component') return
  const action = expandAction(node.state)
  if (action === 'ignore') return
  if (action === 'collapse') {
    // 折叠**不回收**已加载的子节点：再展开不该重取（顺便记住计数，让折回去的
    // 节点能显示「N 项 · 点开时加载」，见 lazyHintLabel 的差异说明）。
    node.state = 'collapsed'
    node.knownCount = node.children.length
    return
  }
  node.state = 'loading'
  node.error = undefined
  try {
    if (node.kind === 'org') {
      const page = await catalogApi.listByOrg(node.id, PAGE)
      node.children = page.items.map(toServiceNode)
      node.total = page.total
    } else {
      const page = await componentApi.listByService(node.id, PAGE)
      node.children = page.items.map((c) => ({
        id: c.id,
        name: c.name,
        kind: 'component' as const,
        state: 'expanded' as const, // 叶子：expanded 表示"无需再加载"
        children: [] as TreeNode[],
        component: c,
      }))
      node.total = page.total
    }
    node.state = 'expanded'
  } catch (e: any) {
    node.state = 'error'
    node.error = errText(e)
  }
}

/**
 * 选中并确保可见。
 * 用**对象引用**而不是 id 做选中态：虚拟滚动会销毁/重建行，但节点对象是稳定的；
 * 而且折叠父节点后子节点会从扁平列表里消失 —— 那时仍应能显示它的详情。
 */
function selectRow(node: TreeNode) {
  selected.value = node
  scrollRowIntoView(node)
}

function scrollRowIntoView(node: TreeNode) {
  const el = scrollEl.value
  if (!el) return
  const row = flat.value.find((r) => r.node.id === node.id)
  if (!row) return
  const next = ensureVisible(row.index, el.scrollTop, el.clientHeight)
  if (next !== el.scrollTop) {
    el.scrollTop = next
    scrollTop.value = next
  }
}

/** 点击行体 = 选中；marker = 展开/折叠（分开绑，避免"想选中却触发展开"）。 */
function select(node: TreeNode) {
  selectRow(node)
}

function onMarker(node: TreeNode) {
  void toggleNode(node)
}

/** 双击：组件直接进详情，其余等同点 marker。 */
function activate(node: TreeNode) {
  if (node.kind === 'component' && node.component) goComponent(node.component)
  else void toggleNode(node)
}

function moveSelection(delta: number) {
  const rows = flat.value
  if (rows.length === 0) return
  const current = rows.findIndex((r) => r.node.id === selectedId.value)
  const next = moveIndex(current, delta, rows.length)
  if (next < 0) return
  selectRow(rows[next].node)
}

function onKeydown(e: KeyboardEvent) {
  const node = selected.value
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      moveSelection(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      moveSelection(-1)
      break
    case 'ArrowRight':
      if (node && node.state === 'collapsed') {
        e.preventDefault()
        void toggleNode(node)
      }
      break
    case 'ArrowLeft':
      if (node && node.state === 'expanded' && node.kind !== 'component') {
        e.preventDefault()
        void toggleNode(node)
      }
      break
    case 'Enter':
      if (node) {
        e.preventDefault()
        activate(node)
      }
      break
  }
}

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement).scrollTop
}

// ---------------------------------------------------------------------------
// 服务端搜索（§4.1：输入即查，不需要展开树）
// ---------------------------------------------------------------------------
let searchTimer: ReturnType<typeof setTimeout> | undefined
/**
 * 请求序号，用于**丢弃过期响应**：打字比网络快时，先发的请求可能后到，
 * 把新关键词的结果覆盖成旧关键词的（表现为"结果和输入框对不上"）。
 */
let searchSeq = 0

function resetSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchSeq++
  hits.value = []
  searchError.value = ''
  searching.value = false
}

watch(query, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  const q = v.trim()
  if (!q) {
    resetSearch()
    return
  }
  searching.value = true
  searchTimer = setTimeout(() => void runSearch(q), SEARCH_DEBOUNCE_MS)
})

async function runSearch(q: string) {
  const seq = ++searchSeq
  try {
    const found = await searchApi.query({ q, limit: SEARCH_LIMIT })
    if (seq !== searchSeq) return
    hits.value = found
    searchError.value = ''
  } catch (e: any) {
    if (seq !== searchSeq) return
    hits.value = []
    searchError.value = '搜索失败：' + errText(e)
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

/** 打开一条命中：组件/流水线跳走；Service 落回本页并定位（§5.3）。 */
function openHit(hit: SearchHit) {
  const to = searchHitRoute(hit)
  if (hit.kind !== 'service') {
    void router.push(to)
    return
  }
  // Service 命中留在本页：先清空搜索框，否则用户只看到"搜索面板还在"，
  // 会以为自己没点中（定位结果被搜索面板盖住了）。
  query.value = ''
  resetSearch()
  const sameNode = route.query.node === to.query?.node
  const sameOrg = (route.query.org ?? '') === (to.query?.org ?? '')
  if (route.path === to.path && sameNode && sameOrg) void locateFromRoute()
  else void router.push(to)
}

// ---------------------------------------------------------------------------
// 深链定位 ?node=<serviceId>&org=<orgName>
// ---------------------------------------------------------------------------
/** 只在**已加载**的分支里深度优先找（懒加载下"没展开"就等于"还不知道"）。 */
function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return undefined
}

function orgNodeById(id: string): TreeNode | undefined {
  return roots.value.find((n) => n.id === id)
}

/**
 * 定位到 `?node=` 指定的 Service 并选中。
 *
 * `?node=` 只承载 **Service id**：组件命中跳组件详情页、流水线命中跳编辑器
 * （见 utils/search.ts searchHitRoute），所以这里只需到 Service 这一层。
 *
 * 三级策略（快 → 慢）：
 *   ① 已加载的树里直接找 —— 页内点击命中时零请求；
 *   ② 组织名提示（`?org=`）→ 直接切到那个组织再找 —— 通常 1 次请求；
 *   ③ 兜底逐个组织扫描 —— M1 组织数少可接受；组织变多时应改为"按 service id
 *      反查所属组织"的服务端端点（已登记为后端缺口）。
 */
async function locateFromRoute() {
  const id = typeof route.query.node === 'string' ? route.query.node : ''
  if (!id) return
  const orgHint = typeof route.query.org === 'string' ? route.query.org : ''

  const current = findNode(roots.value, id)
  if (current) {
    selectRow(current)
    return
  }

  const hinted = orgHint ? orgs.value.find((o) => o.name === orgHint) : undefined
  const ordered = hinted ? [hinted, ...orgs.value.filter((o) => o.id !== hinted.id)] : orgs.value
  for (const o of ordered) {
    const node = orgNodeById(o.id)
    if (!node) continue
    const wasExpanded = node.state === 'expanded'
    if (!wasExpanded) await toggleNode(node)
    const hit = findNode(node.children, id)
    if (hit) {
      selectRow(hit)
      return
    }
    // 扫过但不是目标的组织折回去：一次定位不该留下"所有组织都展开了"的副作用。
    if (!wasExpanded) node.state = 'collapsed'
  }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
onMounted(async () => {
  await boot()
  await locateFromRoute()
})

/** 同路由换 query 不会重挂组件，必须 watch（⌘K 再次命中 Service 时走这条）。 */
watch(
  () => route.query.node,
  () => {
    void locateFromRoute()
  },
)

// 虚拟窗口要用**实时视口高度**：用 ResizeObserver 而不是 window.resize，
// 因为面板高度会被布局变化（灰阶、侧栏折叠、内容增减）影响而窗口尺寸没变。
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (searchTimer) clearTimeout(searchTimer)
})

async function boot() {
  loading.value = true
  loadError.value = ''
  try {
    await loadOrgs()
    if (orgs.value.length > 0) {
      const first = orgs.value[0]
      orgId.value = first.id
      // 自动展开选中的组织：1 次请求，换来"打开页面就能看见服务"。
      const node = orgNodeById(first.id)
      if (node) {
        selected.value = node
        await toggleNode(node)
      }
    }
  } catch (e: any) {
    loadError.value = '加载失败：' + errText(e)
  } finally {
    loading.value = false
    await measureViewport()
  }
}

/** 首屏测量要等一帧：数据渲染前面板高度还没撑开，测出来是 0（窗口会退化成空）。 */
async function measureViewport() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const el = scrollEl.value
  if (!el) return
  viewportHeight.value = el.clientHeight
  if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (scrollEl.value) viewportHeight.value = scrollEl.value.clientHeight
    })
    resizeObserver.observe(el)
  }
}

async function switchOrg(id: string) {
  if (!id || id === orgId.value) return
  orgId.value = id
  const node = orgNodeById(id)
  if (!node) return
  if (node.state !== 'expanded') await toggleNode(node)
  selectRow(node)
}

function onOrgChange(e: Event) {
  void switchOrg((e.target as HTMLSelectElement).value)
}

// ---------------------------------------------------------------------------
// 创建流程
// ---------------------------------------------------------------------------
async function createOrg() {
  if (!orgForm.value.name.trim() || !orgForm.value.slug.trim()) {
    toast.err('组织名称与标识（slug）均必填')
    return
  }
  orgCreating.value = true
  try {
    const org = await orgApi.create({ name: orgForm.value.name.trim(), slug: orgForm.value.slug.trim() })
    toast.ok(`组织「${org.name}」已创建（服务树自动生成）`)
    orgDialog.value = false
    await loadOrgs()
    orgId.value = ''
    await switchOrg(org.id)
  } catch (e: any) {
    toast.err('创建失败：' + errText(e))
  } finally {
    orgCreating.value = false
  }
}

/** 「＋ 添加服务」需要 serviceTreeId，就地懒取（不进主路径）。 */
async function openServiceDialog() {
  if (!orgId.value) return
  try {
    const tree = await orgApi.getServiceTree(orgId.value)
    serviceTreeId.value = tree.id
    serviceDialog.value = true
  } catch (e: any) {
    toast.err('无法获取服务树：' + errText(e))
  }
}

async function createService() {
  if (!serviceTreeId.value) return
  if (!serviceForm.value.key.trim() || !serviceForm.value.name.trim()) {
    toast.err('服务 Key 与名称必填')
    return
  }
  serviceCreating.value = true
  try {
    const s = await catalogApi.create({
      serviceTreeId: serviceTreeId.value,
      key: serviceForm.value.key.trim(),
      name: serviceForm.value.name.trim(),
      ownerTeam: serviceForm.value.ownerTeam.trim() || undefined,
      description: serviceForm.value.description.trim() || undefined,
    })
    toast.ok(`服务「${s.name}」已创建`)
    serviceDialog.value = false
    await reloadOrgServices(orgId.value)
    const node = findNode(roots.value, s.id)
    if (node) selectRow(node)
  } catch (e: any) {
    toast.err('创建失败：' + errText(e))
  } finally {
    serviceCreating.value = false
  }
}

async function createComponent() {
  const svc = selected.value?.service
  if (!svc) return
  if (!compForm.value.key.trim() || !compForm.value.name.trim() || !compForm.value.repoUrl.trim()) {
    toast.err('组件 Key、名称与仓库地址必填')
    return
  }
  compCreating.value = true
  try {
    const c = await componentApi.create({
      serviceId: svc.id,
      key: compForm.value.key.trim(),
      name: compForm.value.name.trim(),
      repoUrl: compForm.value.repoUrl.trim(),
      defaultBranch: compForm.value.defaultBranch.trim() || 'main',
      language: compForm.value.language.trim() || undefined,
      description: compForm.value.description.trim() || undefined,
    })
    toast.ok(`组件「${c.name}」已创建`)
    compDialog.value = false
    // 只重取受影响的那一个服务，而不是整棵树。
    const node = findNode(roots.value, svc.id)
    if (node) {
      node.state = 'collapsed'
      await toggleNode(node)
      const created = findNode(node.children, c.id)
      if (created) selectRow(created)
    }
  } catch (e: any) {
    toast.err('创建失败：' + errText(e))
  } finally {
    compCreating.value = false
  }
}

/** 强制重取某组织的服务列表（创建后刷新，绕过"已展开就跳过"的懒加载短路）。 */
async function reloadOrgServices(id: string) {
  const node = orgNodeById(id)
  if (!node) return
  node.state = 'collapsed'
  await toggleNode(node)
}

function goComponent(c: Component) {
  router.push(`/components/${c.id}`)
}

// ---------------------------------------------------------------------------
// 删除流程（STATUS §2 #13：服务树删除入口 UI）
// 后端契约（DELETE-CONTRACT §1.3）：活跃运行存在 → 409 + {reasons}，
// 其余一律级联软删。前端只负责「确认 + 展示拒绝原因」，不自行判定能否删。
// ---------------------------------------------------------------------------
const deleteTarget = ref<TreeNode>()
const deleteBusy = ref(false)
const deleteBlockedReasons = ref<string[]>([])

/** 打开删除确认框；先清空上一次的拒绝原因。 */
function openDelete(node: TreeNode) {
  deleteTarget.value = node
  deleteBlockedReasons.value = []
}

/** 从内存树里移除一个节点（成功删除后调用，避免再打一次全量刷新）。 */
function removeNodeFromTree(node: TreeNode) {
  if (node.kind === 'org') {
    roots.value = roots.value.filter((n) => n.id !== node.id)
    return
  }
  if (node.kind === 'service') {
    const parent = roots.value.find((o) => o.children.some((c) => c.id === node.id))
    if (parent) parent.children = parent.children.filter((c) => c.id !== node.id)
    return
  }
  // component：找到它所属的服务节点，从 children 里摘掉。
  for (const o of roots.value) {
    for (const s of o.children) {
      if (s.children.some((c) => c.id === node.id)) {
        s.children = s.children.filter((c) => c.id !== node.id)
        return
      }
    }
  }
}

/** 后端 409 拒绝原因：优先读结构化 reasons 列表，回退到 error 文案。 */
function blockedReasons(e: any): string[] {
  const reasons = e?.response?.data?.reasons
  if (Array.isArray(reasons) && reasons.length > 0) return reasons
  const msg = e?.response?.data?.error ?? errText(e)
  return msg ? [msg] : ['删除被拒绝']
}

async function confirmDelete() {
  const node = deleteTarget.value
  if (!node) return
  deleteBusy.value = true
  deleteBlockedReasons.value = []
  try {
    if (node.kind === 'org') await orgApi.remove(node.id)
    else if (node.kind === 'service') await catalogApi.remove(node.id)
    else await componentApi.remove(node.id)

    removeNodeFromTree(node)
    if (selected.value?.id === node.id) selected.value = undefined
    toast.ok(`已删除${kindLabel(node.kind)}「${node.name}」`)
    deleteTarget.value = undefined
  } catch (e: any) {
    if (e?.response?.status === 409) {
      // 活跃运行等硬规则拒绝：把 reasons 留在确认框里，让用户看清为什么不能删，
      // 不自动关弹窗（关了就看不到原因了）。
      deleteBlockedReasons.value = blockedReasons(e)
    } else {
      toast.err('删除失败：' + errText(e))
      deleteTarget.value = undefined
    }
  } finally {
    deleteBusy.value = false
  }
}

function kindLabel(kind: TreeNode['kind']): string {
  return kind === 'org' ? '组织' : kind === 'service' ? '服务' : '组件'
}

/** 删除确认框是否展示（org 删除走平台守卫，前端无需感知，照常调 remove）。 */
const showDeleteConfirm = computed(() => deleteTarget.value !== undefined)

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------
/** 行首标记：展开态 ▾ / 折叠态 ▸ / 加载中 ⋯ / 失败 ⚠ / 叶子 ◦。 */
function marker(node: TreeNode): string {
  if (node.kind === 'component') return '◦'
  switch (node.state) {
    case 'expanded':
      return '▾'
    case 'loading':
      return '⋯'
    case 'error':
      return '⚠'
    default:
      return '▸'
  }
}

/** 行尾提示：懒加载提示 / 子节点数 / 「已加载 N/M」（被 PAGE 截断时不静默）。 */
function rowHint(node: TreeNode): string {
  if (node.state === 'error') return node.error ?? '加载失败'
  if (node.kind === 'component') return ''
  if (node.state === 'expanded') {
    if (node.total !== undefined && node.total > node.children.length) {
      return `${node.children.length}/${node.total}`
    }
    return String(node.children.length)
  }
  return lazyHintLabel(node.state, node.knownCount)
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="crumb"><b>服务树</b></div>
      <div class="toolbar" style="margin-top: 0">
        <select class="select" style="width: auto" :value="orgId" @change="onOrgChange">
          <option v-for="o in orgs" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <button v-if="orgs.length > 0" class="btn btn-pearl btn-sm" @click="orgDialog = true">＋ 创建组织</button>
      </div>
    </div>

    <!-- 加载中先别画"还没有组织"：否则用户可能在数据到达前就点「创建第一个组织」，
         随后撞上 slug 唯一冲突。 -->
    <div v-if="loading && orgs.length === 0" class="card empty" style="padding: 48px 0">加载中…</div>

    <div v-else-if="orgs.length === 0" class="card empty" style="padding: 48px 0">
      <p style="margin-bottom: 16px">还没有组织。组织是服务树的根，创建后会自动生成 1:1 的服务树。</p>
      <button class="btn btn-primary" @click="orgDialog = true">＋ 创建第一个组织</button>
    </div>

    <div v-else class="md">
      <!-- 树面板：自身滚动（§4.1 独立滚动容器）；搜索时切换为结果面板 -->
      <div class="card tree-panel">
        <input v-model="query" class="input" placeholder="🔍 搜索服务 / 组件 / 流水线（不需要展开树）" />

        <!-- 服务端搜索结果（§4.1）：结果行带所属路径以区分同名资源 -->
        <div v-if="query.trim()" class="tree-scroll hit-list">
          <div v-if="searching" class="loading">搜索中…</div>
          <div v-else-if="searchError" class="empty">{{ searchError }}</div>
          <div v-else-if="hits.length === 0" class="empty">无匹配结果</div>
          <template v-else>
            <div v-for="h in hits" :key="`${h.kind}:${h.id}`" class="hit" @click="openHit(h)">
              <div class="hit-line">
                <span class="hit-name">{{ h.name }}</span>
                <span class="hit-kind">{{ SEARCH_KIND_LABEL[h.kind] }}</span>
              </div>
              <div class="hit-path">{{ h.path || '—' }}</div>
            </div>
          </template>
        </div>

        <!-- 树：懒加载 + 虚拟滚动 -->
        <div v-else ref="scrollEl" class="tree-scroll" tabindex="0" @scroll="onScroll" @keydown="onKeydown">
          <div v-if="loading" class="loading">加载中…</div>
          <div v-else-if="loadError" class="empty">{{ loadError }}</div>
          <div v-else-if="flat.length === 0" class="empty">暂无服务数据</div>
          <div v-else class="tree-body" :style="{ height: totalHeight + 'px' }">
            <div
              v-for="row in rowsToRender"
              :key="row.node.id"
              class="tnode"
              :class="[`l${row.depth}`, { sel: row.node.id === selectedId }]"
              :style="{ top: row.index * TREE_ROW_HEIGHT + 'px', height: TREE_ROW_HEIGHT + 'px' }"
              :title="row.node.kind === 'component' ? '点击选中，双击进入组件详情' : '点击选中，双击展开/折叠'"
              @click="select(row.node)"
              @dblclick="activate(row.node)"
            >
              <span class="marker" @click.stop="onMarker(row.node)">{{ marker(row.node) }}</span>
              <span class="tname">{{ row.node.name }}</span>
              <span v-if="rowHint(row.node)" class="hint" :class="{ err: row.node.state === 'error' }">
                {{ rowHint(row.node) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 详情面板 -->
      <div class="card detail-panel">
        <template v-if="selected">
          <h3 style="font-size: 17px; margin-bottom: 12px">{{ selected.name }} 详情</h3>
          <template v-if="selected.kind === 'org'">
            <div class="kv-list">
              <div class="row"><span>类型</span><span>组织（服务树根）</span></div>
              <div class="row"><span>ID</span><span class="mono">{{ selected.id }}</span></div>
              <div class="row">
                <span>服务数</span>
                <span>{{ selected.state === 'expanded' ? selected.children.length : '展开后可见' }}</span>
              </div>
            </div>
            <div class="toolbar">
              <button v-if="selected.state !== 'expanded'" class="btn btn-pearl btn-sm" @click="toggleNode(selected)">
                展开
              </button>
              <button class="btn btn-primary btn-sm" @click="openServiceDialog">＋ 添加服务</button>
              <button class="btn btn-danger btn-sm" @click="openDelete(selected)">🗑 删除组织</button>
            </div>
          </template>
          <template v-else-if="selected.kind === 'service' && selected.service">
            <div class="kv-list">
              <div class="row"><span>Key</span><span class="mono">{{ selected.service.key }}</span></div>
              <div class="row"><span>负责人团队</span><span>{{ selected.service.ownerTeam || '—' }}</span></div>
              <div class="row"><span>描述</span><span>{{ selected.service.description || '—' }}</span></div>
              <div class="row">
                <span>组件数</span>
                <span>{{ selected.state === 'expanded' ? selected.children.length : '展开后可见' }}</span>
              </div>
            </div>
            <div class="toolbar">
              <button v-if="selected.state !== 'expanded'" class="btn btn-pearl btn-sm" @click="toggleNode(selected)">
                加载组件
              </button>
              <button class="btn btn-primary btn-sm" @click="compDialog = true">＋ 添加组件</button>
              <button class="btn btn-danger btn-sm" @click="openDelete(selected)">🗑 删除服务</button>
            </div>
          </template>
          <template v-else-if="selected.kind === 'component' && selected.component">
            <div class="kv-list">
              <div class="row"><span>仓库</span><span class="mono">{{ selected.component.repoUrl || '—' }}</span></div>
              <div class="row"><span>默认分支</span><span class="mono">{{ selected.component.defaultBranch || '—' }}</span></div>
              <div class="row"><span>语言</span><span>{{ selected.component.language || '—' }}</span></div>
            </div>
            <div class="toolbar">
              <button class="btn btn-primary btn-sm" @click="goComponent(selected.component!)">进入组件详情 →</button>
              <button class="btn btn-danger btn-sm" @click="openDelete(selected)">🗑 删除组件</button>
            </div>
          </template>
        </template>
        <div v-else class="empty">选择左侧节点查看详情</div>
      </div>
    </div>

    <!-- 创建组织 -->
    <Modal :open="orgDialog" title="创建组织" @close="orgDialog = false">
      <div class="field">
        <label>组织名称 *</label>
        <input v-model="orgForm.name" class="input" placeholder="如：平台工程部" maxlength="128" />
      </div>
      <div class="field">
        <label>标识 slug *</label>
        <input v-model="orgForm.slug" class="input" placeholder="小写字母/数字/连字符，如 platform-eng" maxlength="64" />
      </div>
      <div class="hint">创建组织后会自动生成同名服务树（default）。</div>
      <template #foot>
        <button class="btn btn-pearl" @click="orgDialog = false">取消</button>
        <button class="btn btn-primary" :disabled="orgCreating" @click="createOrg">
          {{ orgCreating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- 添加服务 -->
    <Modal :open="serviceDialog" title="添加服务" @close="serviceDialog = false">
      <div class="field">
        <label>Key *</label>
        <input v-model="serviceForm.key" class="input" placeholder="英文标识，如 user-center" maxlength="64" />
      </div>
      <div class="field">
        <label>名称 *</label>
        <input v-model="serviceForm.name" class="input" placeholder="如：用户中心" maxlength="128" />
      </div>
      <div class="field">
        <label>负责人团队</label>
        <input v-model="serviceForm.ownerTeam" class="input" placeholder="可选" />
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="serviceForm.description" class="input" placeholder="可选" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="serviceDialog = false">取消</button>
        <button class="btn btn-primary" :disabled="serviceCreating" @click="createService">
          {{ serviceCreating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- 添加组件 -->
    <Modal :open="compDialog" title="添加组件" @close="compDialog = false">
      <div class="field">
        <label>Key *</label>
        <input v-model="compForm.key" class="input" placeholder="英文标识，如 user-api" maxlength="64" />
      </div>
      <div class="field">
        <label>名称 *</label>
        <input v-model="compForm.name" class="input" placeholder="如：用户服务 API" maxlength="128" />
      </div>
      <div class="field">
        <label>仓库地址 *</label>
        <input v-model="compForm.repoUrl" class="input" placeholder="https://github.com/org/repo.git" maxlength="512" />
      </div>
      <div class="field">
        <label>默认分支</label>
        <input v-model="compForm.defaultBranch" class="input" placeholder="main" maxlength="128" />
      </div>
      <div class="field">
        <label>语言</label>
        <input v-model="compForm.language" class="input" placeholder="如 go / typescript（可选）" />
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="compForm.description" class="input" placeholder="可选" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="compDialog = false">取消</button>
        <button class="btn btn-primary" :disabled="compCreating" @click="createComponent">
          {{ compCreating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- 删除确认（STATUS §2 #13：服务树删除入口 UI） -->
    <Modal :open="showDeleteConfirm" :title="`删除${deleteTarget ? kindLabel(deleteTarget.kind) : ''}`" @close="deleteTarget = undefined">
      <p>
        确定要删除{{ deleteTarget ? kindLabel(deleteTarget.kind) : '' }}
        「<b>{{ deleteTarget?.name }}</b>」吗？此操作不可恢复（资源走软删，保留审计轨迹）。
      </p>
      <p v-if="deleteTarget?.kind !== 'component'" class="hint">
        其下的服务 / 组件 / 配置将一并级联删除；存在活跃运行时会被后端拒绝（见下方原因）。
      </p>
      <p v-else class="hint">
        组件下的环境、配置、制品将一并清理；存在活跃运行时会被后端拒绝（见下方原因）。
      </p>
      <ul v-if="deleteBlockedReasons.length" class="reasons">
        <li v-for="r in deleteBlockedReasons" :key="r">{{ r }}</li>
      </ul>
      <template #foot>
        <button class="btn btn-pearl" :disabled="deleteBusy" @click="deleteTarget = undefined">取消</button>
        <button class="btn btn-danger" :disabled="deleteBusy" @click="confirmDelete">
          {{ deleteBusy ? '删除中…' : '删除' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.md { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
.tree-panel { padding: 14px; }
.tree-panel .input { margin-bottom: 10px; }
/* 树面板自身滚动、高度有界 —— 页面不随树变长（§4.1 独立滚动容器） */
.tree-scroll { height: calc(100vh - 260px); overflow-y: auto; outline: none; }
/* 虚拟滚动容器：高度由 JS 按「行数 × 行高」设定，行用绝对定位摆放。
   行高**不写在这里**（写死会和 utils/tree.ts 的 TREE_ROW_HEIGHT 漂移），
   由模板内联 style 统一给出。 */
.tree-body { position: relative; }
.tnode {
  position: absolute; left: 0; right: 0;
  display: flex; align-items: center; gap: 6px;
  padding: 0 10px; border-radius: 8px; font-size: 14px; cursor: pointer;
  box-sizing: border-box; overflow: hidden; white-space: nowrap;
}
.tnode:hover { background: var(--parchment); }
.tnode.sel { background: var(--action-blue-soft); color: var(--action-blue); font-weight: 600; }
.tnode.l1 { padding-left: 26px; font-size: 13px; }
.tnode.l2 { padding-left: 44px; font-size: 13px; color: var(--sub); }
.marker { font-size: 10px; color: var(--sub); width: 12px; flex: none; text-align: center; }
.tname { overflow: hidden; text-overflow: ellipsis; }
.hint { margin-left: auto; font-size: 11px; color: var(--sub); flex: none; }
.hint.err { color: var(--failed-fg); }
.hit-list { padding-right: 2px; }
.hit { padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.hit:hover { background: var(--parchment); }
.hit-line { display: flex; align-items: center; gap: 8px; }
.hit-name { font-size: 13px; }
.hit-kind {
  margin-left: auto; flex: none; font-size: 11px; color: var(--sub);
  border: 1px solid var(--sub-hairline); border-radius: 999px; padding: 0 6px;
}
.hit-path { font-size: 11px; color: var(--sub); margin-top: 2px; }
.detail-panel { min-height: 300px; }
.btn-danger { background: var(--failed-fg); border-color: var(--failed-fg); color: #fff; }
.btn-danger:hover { filter: brightness(0.94); }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }
.reasons { margin: 8px 0 0; padding-left: 18px; color: var(--failed-fg); font-size: 13px; }
.reasons li { margin: 2px 0; }
.kv-list { margin-top: 12px; }
.kv-list .row {
  display: flex; justify-content: space-between; gap: 16px;
  padding: 9px 0; border-bottom: 1px solid var(--sub-hairline); font-size: 13px;
}
.kv-list .row span:first-child { color: var(--sub); }
</style>
