// 服务树规模化（R-8）契约冒烟：懒加载状态机 / 虚拟滚动窗口 / 服务端搜索。
// 跑法：pnpm test:service-tree（或 node scripts/service-tree-smoke.mjs）。
//
// 与 scripts/theme-and-search-smoke.mjs 同一手法：
//   - 纯逻辑**直接 import 源码 .ts**（Node ≥22.18 原生类型剥离）—— 测出厂代码本身；
//   - 涉及 DOM / 网络的部分（滚动、请求）不在这里测，改为**静态断言**源码里的
//     关键不变量，防止"改回一次性拉全树"这类回归。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OVERSCAN,
  TREE_ROW_HEIGHT,
  VIRTUALIZE_THRESHOLD,
  computeWindow,
  ensureVisible,
  expandAction,
  flattenVisible,
  lazyHintLabel,
  shouldVirtualize,
} from '../src/utils/tree.ts'
import { SEARCH_KIND_LABEL, hitFromDto, searchHitRoute } from '../src/utils/search.ts'

let pass = 0
const cases = []
function check(name, fn) {
  try {
    fn()
    cases.push(`  ✓ ${name}`)
    pass++
  } catch (e) {
    cases.push(`  ✗ ${name}\n      ${e.message}`)
  }
}

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 造节点：state 决定扁平化会不会下钻。 */
function node(id, state, children = []) {
  return { id, name: id, state, children }
}

// ===========================================================================
// 一、懒加载状态机
// ===========================================================================

check('行高/阈值/overscan 是 §4.1 定下的常量', () => {
  assert.equal(TREE_ROW_HEIGHT, 30)
  assert.equal(VIRTUALIZE_THRESHOLD, 200, '§4.1：≥200 节点启用窗口化渲染')
  assert.ok(OVERSCAN >= 1 && OVERSCAN <= 12, 'overscan 应在"防露白"与"不白渲染"之间')
})

check('点击动作：折叠才加载、加载中忽略、展开则折叠、失败重试', () => {
  assert.equal(expandAction('collapsed'), 'load')
  assert.equal(expandAction('loading'), 'ignore', '连点不能打出一串并发请求')
  assert.equal(expandAction('expanded'), 'collapse')
  assert.equal(expandAction('error'), 'retry')
})

check('折叠提示：计数未知不编数字，已知才显示「N 项」', () => {
  // §4.1 原型写的是「N 项 · 点开时加载」，但 N 只有请求过才知道 ——
  // 懒加载的全部意义就是不提前请求，所以这里刻意不编 N（见 utils/tree.ts 注释）。
  assert.equal(lazyHintLabel('collapsed'), '点开时加载')
  assert.equal(lazyHintLabel('collapsed', 0), '0 项 · 点开时加载')
  assert.equal(lazyHintLabel('collapsed', 7), '7 项 · 点开时加载')
  assert.equal(lazyHintLabel('loading'), '加载中…')
  assert.equal(lazyHintLabel('error'), '加载失败 · 点击重试')
  assert.equal(lazyHintLabel('expanded'), '', '展开态不画提示（子节点已可见）')
})

// ===========================================================================
// 二、扁平化 + 虚拟滚动窗口
// ===========================================================================

check('只有 expanded 的节点才下钻（懒加载不被渲染层绕过）', () => {
  const tree = [
    node('org1', 'expanded', [node('svc1', 'collapsed', [node('c1', 'expanded')])]),
    node('org2', 'collapsed', [node('svc2', 'expanded')]),
  ]
  const rows = flattenVisible(tree)
  assert.deepEqual(rows.map((r) => r.node.id), ['org1', 'svc1', 'org2'], '折叠节点的子层必须不出现')
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 0])
  assert.deepEqual(rows.map((r) => r.index), [0, 1, 2], 'index 必须等于它在列表里的下标')
})

check('展开到三层时 depth 与 index 都对', () => {
  const tree = [node('org', 'expanded', [node('svc', 'expanded', [node('c1', 'expanded'), node('c2', 'expanded')])])]
  const rows = flattenVisible(tree)
  assert.deepEqual(rows.map((r) => `${r.node.id}@${r.depth}#${r.index}`), ['org@0#0', 'svc@1#1', 'c1@2#2', 'c2@2#3'])
})

check('空树 / 空 children 不产生幽灵行', () => {
  assert.deepEqual(flattenVisible([]), [])
  assert.deepEqual(flattenVisible([node('a', 'expanded', [])]).map((r) => r.node.id), ['a'])
})

check('窗口：总数为 0 时不渲染任何行', () => {
  assert.deepEqual(computeWindow(0, 0), { start: 0, end: 0, offsetY: 0, totalHeight: 0 })
})

check('窗口：顶部 / 中部 / 底部都只覆盖视口 + overscan', () => {
  const total = 500
  const viewport = 10 * TREE_ROW_HEIGHT // 可见 10 行

  const top = computeWindow(0, total, { viewportHeight: viewport })
  assert.equal(top.start, 0)
  assert.equal(top.end, 10 + OVERSCAN, '顶部不该多渲染下方一整屏')
  assert.equal(top.totalHeight, total * TREE_ROW_HEIGHT, '撑开滚动条的高度 = 总行数 × 行高')

  const mid = computeWindow(100 * TREE_ROW_HEIGHT, total, { viewportHeight: viewport })
  assert.equal(mid.start, 100 - OVERSCAN)
  assert.equal(mid.end, 110 + OVERSCAN)
  assert.equal(mid.offsetY, mid.start * TREE_ROW_HEIGHT)
  const rendered = mid.end - mid.start
  assert.ok(rendered < total / 4, `窗口化必须显著小于总数，实际渲染 ${rendered}/${total}`)

  const bottom = computeWindow(1000 * TREE_ROW_HEIGHT, total, { viewportHeight: viewport })
  assert.equal(bottom.end, total, '滚过头时收在最后一行')
  // 这条断言是**写测试时抓到的真实缺陷**：不夹取时 start 会大于 end，区间反转，
  // 上层 slice(start, end) 得到空数组 —— 表现为树突然白掉。
  assert.ok(bottom.start < bottom.end, `窗口区间不能反转（start=${bottom.start} end=${bottom.end}）`)
  assert.ok(total - bottom.start <= viewport / TREE_ROW_HEIGHT + OVERSCAN, '夹取后仍应是"最后一屏"而非全量')
})

check('窗口：负 scrollTop / 负视口高不越界（浏览器回弹会给出负值）', () => {
  const w = computeWindow(-50, 100, { viewportHeight: -10 })
  assert.equal(w.start, 0)
  assert.ok(w.end >= 0 && w.end <= 100)
})

check('窗口：视口为 0 也只渲染 overscan 条，不退化成"渲染全部"', () => {
  const w = computeWindow(0, 1000, { viewportHeight: 0 })
  assert.equal(w.end, OVERSCAN)
  assert.ok(w.end < 1000)
})

check('阈值：199 不启用、200 启用', () => {
  assert.equal(shouldVirtualize(199), false)
  assert.equal(shouldVirtualize(200), true)
  assert.equal(shouldVirtualize(0), false)
})

check('ensureVisible：已可见不动、在上方贴顶、在下方贴底', () => {
  const vp = 300 // 10 行
  assert.equal(ensureVisible(3, 0, vp), 0, '第 3 行已在视口里，不该跳')
  assert.equal(ensureVisible(0, 300, vp), 0, '在上方 → 滚到该行')
  assert.equal(ensureVisible(20, 0, vp), 20 * TREE_ROW_HEIGHT + TREE_ROW_HEIGHT - vp, '在下方 → 刚好露出整行')
  assert.equal(ensureVisible(-1, 120, vp), 120, '无选中时不滚动')
})

// ===========================================================================
// 三、服务端搜索契约（附 A N-8 / N-9）
// ===========================================================================

check('searchHitRoute：Service 命中带 org 定位提示，组件/流水线照旧', () => {
  assert.deepEqual(searchHitRoute({ kind: 'component', id: 'c1', name: '', path: '' }), { path: '/components/c1' })
  assert.deepEqual(searchHitRoute({ kind: 'pipeline', id: 'p1', name: '', path: '' }), { path: '/pipelines/p1' })
  // org 是定位提示（省掉逐个组织扫描），不是权威数据；服务命中的 path 就是组织名。
  assert.deepEqual(searchHitRoute({ kind: 'service', id: 's1', name: '', path: 'platform-eng' }), {
    path: '/service-tree',
    query: { node: 's1', org: 'platform-eng' },
  })
  // path 缺失时退化为只带 node（页面侧有兜底扫描）。
  assert.deepEqual(searchHitRoute({ kind: 'service', id: 's1', name: '', path: '' }), {
    path: '/service-tree',
    query: { node: 's1' },
  })
})

check('hitFromDto：type → kind 翻译；未知类型丢弃而不是导航到 404', () => {
  assert.deepEqual(hitFromDto({ type: 'component', id: 'x', name: 'n', path: 'o / s' }), {
    kind: 'component',
    id: 'x',
    name: 'n',
    path: 'o / s',
    keyword: undefined,
  })
  assert.deepEqual(hitFromDto({ type: 'service', id: 's', name: 'n', path: 'o', keyword: 'svc-key' })?.kind, 'service')
  assert.equal(hitFromDto({ type: 'target', id: 't', name: 'n', path: 'o' }), undefined, '后端日后新增类型时应先不展示')
  assert.equal(hitFromDto({ type: 'component', id: '', name: 'n', path: '' }), undefined, '无 id 无法导航')
  assert.equal(hitFromDto(null), undefined)
})

// ===========================================================================
// 四、页面侧静态断言（防"改回一次性拉全树"）
// ===========================================================================

check('服务树页走 N-9 的按组织列服务端点，且不再预拉组件', () => {
  const src = read('../src/views/ServiceTreeView.vue')
  assert.ok(src.includes('catalogApi.listByOrg'), '应使用 GET /orgs/:id/services（附 A N-9）')
  assert.ok(!src.includes('listByServiceTree'), '懒加载路径不该再走"先查树 id 再列服务"的两跳')
  // 旧实现的指纹：在 load() 里对每个服务各发一次组件列表。它一旦回来，
  // "展开才请求"就退化回"一次拉全树"，而这一点在浏览器里看不出来。
  assert.ok(!/for \(const s of services\.items\)/.test(src), '疑似恢复了一次性拉全树的旧实现')
})

check('懒加载四态在页面里真的被处理（加载中 / 失败 / 成功 / 折叠）', () => {
  const src = read('../src/views/ServiceTreeView.vue')
  assert.ok(src.includes('expandAction(node.state)'), '展开动作必须由 utils/tree 的状态机决定')
  assert.ok(src.includes("node.state = 'loading'"))
  assert.ok(src.includes("node.state = 'expanded'"))
  assert.ok(src.includes("node.state = 'error'"), '失败必须落到 error 态（不能静默吞）')
  assert.ok(src.includes('node.error = errText(e)'), '失败原因要挂到节点上，行内可见')
  assert.ok(src.includes('knownCount'), '折叠后要记住子节点数，否则永远显示不出「N 项」')
})

check('虚拟滚动：窗口来自 utils，行高**不写死在 CSS**（防两处漂移）', () => {
  const src = read('../src/views/ServiceTreeView.vue')
  assert.ok(src.includes('computeWindow(') && src.includes('shouldVirtualize('), '窗口计算必须复用 utils/tree')
  assert.ok(src.includes('TREE_ROW_HEIGHT'), '行高必须引用常量')
  assert.ok(
    /top:\s*row\.index \* TREE_ROW_HEIGHT/.test(src) && /height:\s*TREE_ROW_HEIGHT/.test(src),
    '行高必须由同源的常量内联给出',
  )
  // 样式块里再声明一次高度，就等于有了第二个真相来源。
  const style = src.slice(src.indexOf('<style scoped>'))
  assert.ok(!/\.tnode\s*\{[^}]*\bheight:\s*\d/.test(style), '.tnode 不应在 CSS 里另写一个高度')
  assert.ok(!/\.tree-body\s*\{[^}]*\bheight:\s*\d/.test(style), '.tree-body 高度由 JS 按行数算出')
})

check('独立滚动容器：树面板自滚且高度有界（页面不随树变长）', () => {
  const src = read('../src/views/ServiceTreeView.vue')
  const style = src.slice(src.indexOf('<style scoped>'))
  assert.ok(/\.tree-scroll\s*\{[^}]*overflow-y:\s*auto/.test(style), '.tree-scroll 必须自身滚动')
  assert.ok(/\.tree-scroll\s*\{[^}]*height:\s*calc\(/.test(style), '.tree-scroll 必须高度有界，否则整页跟着变长')
  assert.ok(src.includes('@scroll="onScroll"'), '滚动位置要回填给窗口计算')
  assert.ok(src.includes('viewportHeight'), '窗口计算需要实时视口高度')
})

check('服务端搜索：防抖 + 丢弃过期响应 + 不吞错', () => {
  const src = read('../src/views/ServiceTreeView.vue')
  assert.ok(src.includes('searchApi.query('), '应打 GET /search')
  assert.ok(src.includes('SEARCH_DEBOUNCE_MS'), '防抖必须用 §5.3 的常量')
  assert.ok(src.includes('searchSeq'), '必须有请求序号，否则打字快于网络时结果会串词')
  assert.ok(src.includes('if (seq !== searchSeq) return'), '过期响应必须被丢弃')
  assert.ok(src.includes('searchError'), '搜索失败要显示，不能静默成"无结果"')
  // 结果行必须带所属路径（§4.1：区分同名资源）。
  assert.ok(src.includes('hit-path'), '搜索结果行缺少所属路径')
})

check('⌘K 浮层：服务端优先、客户端索引兜底，且降级可见', () => {
  const src = read('../src/composables/useGlobalSearch.ts')
  assert.ok(src.includes('searchApi.query('), '⌘K 应优先走服务端搜索')
  assert.ok(src.includes('buildResourceIndex'), '空查询的"头部视图"与降级仍需要索引')
  assert.ok(src.includes('serverActive'), '必须有"用服务端结果"的判定')
  assert.ok(/serverQuery === state\.debounced/.test(src), '服务端结果必须只在"属于当前查询词"时使用')
  assert.ok(src.includes('fallbackNotice'), '降级提示必须能被浮层读到')
  const palette = read('../src/components/CommandPalette.vue')
  assert.ok(palette.includes('fallbackNotice'), '降级提示必须在浮层里渲染出来（静默降级会误导）')
})

check('api 层只做请求与翻译，翻译函数在 utils（可被 node 直接测）', () => {
  const api = read('../src/api/search.ts')
  assert.ok(api.includes('hitFromDto'), 'api 层应复用 utils/search 的纯翻译函数')
  assert.ok(!api.includes('include(') || !api.includes('SEARCH_KINDS'), '类型白名单只应有一处定义')
})

check('搜索类型标签与后端模型取值一致（service/component/pipeline）', () => {
  assert.deepEqual(Object.keys(SEARCH_KIND_LABEL).sort(), ['component', 'pipeline', 'service'])
})

console.log(cases.join('\n'))
console.log(`\n${pass}/${cases.length} passed`)
process.exit(pass === cases.length ? 0 : 1)
