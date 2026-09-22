// 双主题（C-02）+ 全局搜索（C-01）契约冒烟。
// 跑法：pnpm test:theme-search（或 node scripts/theme-and-search-smoke.mjs）。
//
// 与 scripts/runcenter-url-smoke.mjs 同一手法：直接 import 源码 .ts（Node ≥22.18
// 原生类型剥离）—— 测的是出厂代码本身，不是复制品；涉及 DOM 的部分（浮层渲染、
// localStorage 读写）不在这里测，改为**静态断言**源码里的关键不变量，防止回归。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GRAY_CLASS,
  GRAY_STORAGE_KEY,
  THEME_ATTR,
  THEME_STORAGE_KEY,
  isThemeMode,
  nextTheme,
  normalizeTheme,
  parseGray,
  resolveInitialTheme,
  serializeGray,
  themeToggleLabel,
} from '../src/utils/theme.ts'
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_KIND_LABEL,
  SEARCH_LIMIT,
  isPaletteShortcut,
  matchHits,
  moveIndex,
  scoreHit,
  searchHitKey,
  searchHitRoute,
} from '../src/utils/search.ts'

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

// ===========================================================================
// 一、主题（§9.6 / §9.2）
// ===========================================================================

check('存储键与属性名固定（index.html 内联脚本按字面量依赖它们）', () => {
  assert.equal(THEME_ATTR, 'data-theme')
  assert.equal(GRAY_CLASS, 'gray')
  assert.equal(THEME_STORAGE_KEY, 'sdp.console.theme')
  assert.equal(GRAY_STORAGE_KEY, 'sdp.console.gray')
})

check('normalizeTheme 只认 light/dark，大小写与垃圾值一律 null', () => {
  assert.equal(normalizeTheme('light'), 'light')
  assert.equal(normalizeTheme('dark'), 'dark')
  assert.equal(normalizeTheme('DARK'), null)
  assert.equal(normalizeTheme(''), null)
  assert.equal(normalizeTheme(null), null)
  assert.equal(normalizeTheme(undefined), null)
  assert.equal(normalizeTheme(0), null)
  assert.equal(isThemeMode('dark'), true)
  assert.equal(isThemeMode('system'), false)
})

check('默认值解析：localStorage 优先，其次 prefers-color-scheme', () => {
  assert.equal(resolveInitialTheme('dark', false), 'dark', '存过就以存储为准')
  assert.equal(resolveInitialTheme('light', true), 'light', '存储优先于系统偏好')
  assert.equal(resolveInitialTheme(null, true), 'dark', '没存过才看系统')
  assert.equal(resolveInitialTheme(null, false), 'light')
  assert.equal(resolveInitialTheme('garbage', true), 'dark', '非法值等同没存过')
})

check('主题只有两态且可来回切换（无第三态、无 reset）', () => {
  assert.equal(nextTheme('light'), 'dark')
  assert.equal(nextTheme('dark'), 'light')
  assert.equal(nextTheme(nextTheme('light')), 'light')
})

check('顶栏按钮文案 = 下一步动作（暗色时显示「明」）', () => {
  assert.equal(themeToggleLabel('dark'), '明')
  assert.equal(themeToggleLabel('light'), '暗')
})

check('灰阶开关只认字符串 "1"（"0"/null/布尔真都不算开）', () => {
  assert.equal(parseGray('1'), true)
  assert.equal(parseGray('0'), false)
  assert.equal(parseGray(null), false)
  assert.equal(parseGray('true'), false)
  assert.equal(parseGray(true), false)
  assert.equal(serializeGray(true), '1')
  assert.equal(serializeGray(false), '0')
  assert.equal(parseGray(serializeGray(true)), true)
})

check('index.html 内联脚本与 utils/theme.ts 的键名/属性/取值同步（防白闪逻辑漂移）', () => {
  const html = read('../index.html')
  assert.ok(html.includes(`localStorage.getItem('${THEME_STORAGE_KEY}')`), 'index.html 未读主题存储键')
  assert.ok(html.includes(`localStorage.getItem('${GRAY_STORAGE_KEY}')`), 'index.html 未读灰阶存储键')
  assert.ok(html.includes(`'${THEME_ATTR}'`), 'index.html 未设置 data-theme')
  assert.ok(html.includes(`classList.add('${GRAY_CLASS}')`), 'index.html 未挂灰阶 class')
  assert.ok(html.includes("'light'") && html.includes("'dark'"), 'index.html 未处理两个主题取值')
  // 必须在 </head> 之前 —— 否则样式先绘制，白闪照旧
  assert.ok(
    html.indexOf(THEME_STORAGE_KEY) < html.indexOf('</head>'),
    '主题引导脚本没有出现在 </head> 之前，防白闪失效',
  )
})

check('令牌表：暗色块存在、左栏走 --rail-bg、海军蓝已清除', () => {
  const css = read('../src/styles/tokens.css')
  assert.ok(css.includes(':root[data-theme="dark"]'), '缺少暗色令牌块')
  assert.ok(css.includes('--rail-bg:'), '缺少 --rail-bg 令牌（§9.2）')
  assert.ok(css.includes('--rail-active-bg:'), '缺少 --rail-active-bg 令牌')
  assert.ok(css.includes('--bg:') && css.includes('--surface:') && css.includes('--accent:'), '缺少 §9.2 权威令牌')
  // §9.2 / P4：light 左栏不再用海军蓝。只查**声明式用法** —— 源码注释里
  // 保留「原先是 #001529」这句改动说明是有价值的，不该被断言误伤。
  assert.ok(!/background(-color)?\s*:\s*#001529/i.test(css), 'tokens.css 仍把海军蓝 #001529 当底色（P4 未清）')
  assert.ok(!css.includes('--menu-bg'), '仍残留 --menu-bg 别名，应按 §9.2 统一为 --rail-bg')
  // 灰阶自检（§9.6）
  assert.ok(/^:root\.gray\s*\{/.test(css.trim()) || css.includes(':root.gray {'), '缺少 :root.gray 灰阶规则')
  // 暗色块必须真的覆盖关键令牌，而不是空壳
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'))
  for (const token of ['--bg:', '--surface:', '--text:', '--accent:', '--rail-bg:', '--succeeded-bg:', '--failed-fg:']) {
    assert.ok(dark.includes(token), `暗色块未覆盖 ${token}`)
  }
})

check('骨架：左栏用 rail 令牌且不再有 3px 竖条 / 深蓝文字', () => {
  const layout = read('../src/layout/MainLayout.vue')
  assert.ok(layout.includes('var(--rail-bg)'), 'MainLayout 未使用 --rail-bg')
  assert.ok(layout.includes('var(--rail-active-bg)'), 'MainLayout 未使用 --rail-active-bg')
  assert.ok(!/background(-color)?\s*:\s*#001529/i.test(layout), 'MainLayout 仍把海军蓝当底色（注释里提历史可以，声明里不行）')
  assert.ok(!layout.includes('rgba(255, 255, 255, 0.75)'), 'MainLayout 仍按深底设文字色')
  assert.ok(!layout.includes('width: 3px'), '§7.1 明令"不用 3px 竖条"，仍存在竖条样式')
  assert.ok(layout.includes('width: 268px') && layout.includes('width: 64px'), '左栏宽度应为 268 → 64（§5.1/§7.1）')
})

check('壳层不再散落硬编码浅色（走查清单：8 个文件已令牌化）', () => {
  // 这几个是本轮 C-02 明确改掉的位置，钉住防止回潮。
  const mustNotHaveLooseWhite = [
    '../src/components/Modal.vue',
    '../src/components/Drawer.vue',
    '../src/views/component/tabs/OverviewTab.vue',
    '../src/views/ReleaseDetailView.vue',
    '../src/components/environment/EnvTree.vue',
  ]
  for (const rel of mustNotHaveLooseWhite) {
    const src = read(rel)
    assert.ok(!/background:\s*#fff\b/.test(src), `${rel} 仍有 background: #fff`)
  }
  const modal = read('../src/components/Modal.vue')
  assert.ok(modal.includes('var(--scrim)') && modal.includes('var(--shadow-pop)'), 'Modal 未用 --scrim/--shadow-pop')
})

check('PermissionsTab 不再引用未定义的令牌（--border/--primary/--muted-fg）', () => {
  const src = read('../src/views/component/tabs/PermissionsTab.vue')
  for (const bogus of ['var(--border)', 'var(--primary)', 'var(--muted-fg)']) {
    assert.ok(!src.includes(bogus), `PermissionsTab 仍引用未定义令牌 ${bogus}`)
  }
})

// ===========================================================================
// 二、全局搜索（§5.3 / §7.5）
// ===========================================================================

const HITS = [
  { kind: 'service', id: 's1', name: 'svc-a', path: 'platform-eng' },
  { kind: 'component', id: 'c1', name: 'comp-web', path: 'platform-eng / svc-a', keyword: 'comp-web-key' },
  { kind: 'component', id: 'c2', name: 'comp-web-old', path: 'platform-eng / svc-a' },
  { kind: 'component', id: 'c3', name: 'svc-web', path: 'platform-eng / svc-b' },
  { kind: 'pipeline', id: 'p1', name: '生产发布', path: 'comp-api · release' },
]

check('上限与防抖是 §5.3 定下的常量', () => {
  assert.equal(SEARCH_LIMIT, 20)
  assert.equal(SEARCH_DEBOUNCE_MS, 200)
})

check('类型标签固定（组件/流水线/Service）', () => {
  assert.deepEqual(SEARCH_KIND_LABEL, { component: '组件', pipeline: '流水线', service: 'Service' })
})

check('快捷键：⌘K 与 Ctrl+K 都行，单独 k 不行', () => {
  assert.equal(isPaletteShortcut({ metaKey: true, key: 'k' }), true)
  assert.equal(isPaletteShortcut({ ctrlKey: true, key: 'K' }), true, '大小写不敏感')
  assert.equal(isPaletteShortcut({ metaKey: true, ctrlKey: true, key: 'k' }), true)
  assert.equal(isPaletteShortcut({ key: 'k' }), false, '裸 k 不该唤起浮层')
  assert.equal(isPaletteShortcut({ metaKey: true, key: 'j' }), false)
  assert.equal(isPaletteShortcut({}), false)
})

check('空查询返回索引前 20 条（浮层打开即可键盘浏览）', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ kind: 'component', id: `x${i}`, name: `n${i}`, path: 'p' }))
  assert.equal(matchHits(many, '').length, SEARCH_LIMIT)
  assert.deepEqual(matchHits(HITS, '').map((h) => h.id), ['s1', 'c1', 'c2', 'c3', 'p1'])
  assert.equal(matchHits(many, '   ').length, SEARCH_LIMIT, '纯空白按空查询处理')
})

check('大小写不敏感，且 path / 类型名 / keyword 都能命中', () => {
  assert.deepEqual(matchHits(HITS, 'COMP-WEB').map((h) => h.id).includes('c1'), true)
  assert.deepEqual(matchHits(HITS, 'platform-eng').map((h) => h.id), ['s1', 'c1', 'c2', 'c3'])
  assert.deepEqual(matchHits(HITS, '流水线').map((h) => h.id), ['p1'], '类型名本身可搜')
  assert.deepEqual(matchHits(HITS, 'comp-web-key').map((h) => h.id), ['c1'], 'keyword 参与匹配')
})

check('精确命中排第一（否则回车打开的很可能是错的那个）', () => {
  assert.deepEqual(matchHits(HITS, 'comp-web').map((h) => h.id), ['c1', 'c2'], 'comp-web 必须排在 comp-web-old 前')
  assert.equal(scoreHit(HITS[1], 'comp-web'), 0, '全等 = 0 分（最好）')
  assert.equal(scoreHit(HITS[2], 'comp-web'), 1, '前缀 = 1 分')
})

check('名称命中优于路径命中', () => {
  // 'svc' 在 svc-a 是名称子串，在 c1/c2/c3 的 path 里也有；名称命中必须先出
  const ids = matchHits(HITS, 'svc-a').map((h) => h.id)
  assert.equal(ids[0], 's1', `名称全等应排最前，实际 ${JSON.stringify(ids)}`)
})

check('同分项保持索引原序（排序结果可重复）', () => {
  assert.deepEqual(matchHits(HITS, 'platform-eng').map((h) => h.id), ['s1', 'c1', 'c2', 'c3'])
  const again = matchHits(HITS, 'platform-eng').map((h) => h.id)
  assert.deepEqual(again, ['s1', 'c1', 'c2', 'c3'], '两次调用结果必须一致')
})

check('不命中返回空数组（浮层据此进"空态"）', () => {
  assert.deepEqual(matchHits(HITS, 'zzzz-no-such'), [])
  assert.equal(scoreHit(HITS[0], 'zzzz'), -1)
})

check('limit 参数生效（截断发生在排序之后）', () => {
  assert.deepEqual(matchHits(HITS, 'platform-eng', 2).map((h) => h.id), ['s1', 'c1'])
  assert.deepEqual(matchHits(HITS, '', 3).map((h) => h.id), ['s1', 'c1', 'c2'])
})

check('打开行为：组件/流水线/Service 三条路由固定（§5.3）', () => {
  assert.deepEqual(searchHitRoute({ kind: 'component', id: 'abc', name: '', path: '' }), { path: '/components/abc' })
  assert.deepEqual(searchHitRoute({ kind: 'pipeline', id: 'p9', name: '', path: '' }), { path: '/pipelines/p9' })
  // Service 不是独立详情页，落到服务树并**带 node 深链定位**。
  // 服务命中的 path 就是所属组织名 → 一并作为定位提示（R-8 懒加载下省掉逐个组织扫描）；
  // path 为空时退化成只带 node（`scripts/service-tree-smoke.mjs` 覆盖了两种情形）。
  assert.deepEqual(searchHitRoute({ kind: 'service', id: 's7', name: '', path: '' }), {
    path: '/service-tree',
    query: { node: 's7' },
  })
  assert.deepEqual(searchHitRoute({ kind: 'service', id: 's7', name: '', path: 'platform-eng' }), {
    path: '/service-tree',
    query: { node: 's7', org: 'platform-eng' },
  })
})

check('ServiceTreeView 确实消费 ?node= 深链（否则"定位"是空话）', () => {
  const src = read('../src/views/ServiceTreeView.vue')
  assert.ok(src.includes("route.query.node"), 'ServiceTreeView 未读取 ?node=')
  assert.ok(src.includes('locateFromRoute'), 'ServiceTreeView 未实现定位')
  assert.ok(/watch\(\s*\(\)\s*=>\s*route\.query\.node/.test(src), '同路由换 query 不会重挂组件，必须 watch')
})

check('结果 key 稳定：同名不同 id、跨类型同 id 都能区分', () => {
  assert.equal(searchHitKey({ kind: 'component', id: 'x', name: 'a', path: '' }), 'component:x')
  assert.notEqual(
    searchHitKey({ kind: 'component', id: 'x', name: 'a', path: '' }),
    searchHitKey({ kind: 'service', id: 'x', name: 'a', path: '' }),
  )
})

check('↑↓ 不环绕：到顶/到底即停，无选中时按下键从第一条开始', () => {
  assert.equal(moveIndex(-1, 1, 5), 0, '无选中时按下键 → 第一条')
  assert.equal(moveIndex(-1, -1, 5), 4, '无选中时按上键 → 最后一条')
  assert.equal(moveIndex(0, -1, 5), 0, '顶到头停住')
  assert.equal(moveIndex(4, 1, 5), 4, '到底停住')
  assert.equal(moveIndex(2, 1, 5), 3)
  assert.equal(moveIndex(2, -1, 5), 1)
  assert.equal(moveIndex(0, 1, 0), -1, '空列表没有可选项')
  assert.equal(moveIndex(-1, 1, 0), -1)
})

console.log(cases.join('\n'))
console.log(`\n${pass}/${cases.length} passed`)
process.exit(pass === cases.length ? 0 : 1)
