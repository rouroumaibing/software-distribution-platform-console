// 纯逻辑属性测试（建议 9）：确定性生成器 × 不变量 / 幂等 / round-trip / 等价四模式。
// 直接 import 出厂源码 .ts（Node ≥22.18 原生类型剥离），不复制实现、不依赖外部库。
// 跑法：node scripts/property-test.mjs；接 pnpm test:property 与 CI。
import assert from 'node:assert/strict'
import {
  computeWindow,
  ensureVisible,
  flattenVisible,
  shouldVirtualize,
} from '../src/utils/tree.ts'
import {
  formatExpiryISO,
  knownSubjects,
  parseActions,
} from '../src/utils/permission.ts'
import { isRunCancellable, isRunTerminal } from '../src/utils/run.ts'

// 确定性 LCG（固定种子）：每次运行同一组输入，失败可复现。
let seed = 0x9e3779b9
function rnd() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const pick = (a) => a[int(0, a.length - 1)]

const ROUNDS = 600
let checks = 0
const ok = (cond, msg) => { checks++; assert.ok(cond, msg) }

// ---- 模式一：不变量（computeWindow 窗口永不反转、偏移/高度自洽） ----
for (let i = 0; i < ROUNDS; i++) {
  const total = int(0, 400)
  const rowHeight = int(1, 60)
  const viewportHeight = int(0, 900)
  const overscan = int(0, 12)
  const scrollTop = int(-200, 2000)
  const r = computeWindow(scrollTop, total, { rowHeight, viewportHeight, overscan })
  ok(r.start >= 0, `start>=0 total=${total} st=${scrollTop}`)
  ok(r.end >= r.start, `end>=start total=${total} st=${scrollTop} got ${r.start}..${r.end}`)
  ok(r.end <= total, `end<=total total=${total} got end=${r.end}`)
  ok(r.offsetY === r.start * rowHeight, `offsetY self-consistent`)
  ok(r.totalHeight === total * rowHeight, `totalHeight self-consistent`)
}

// ---- 模式二：幂等（parseActions / knownSubjects 二次归一不变） ----
const seps = ['\n', ',', '，', ' ', '\t', '  ']
for (let i = 0; i < ROUNDS; i++) {
  const n = int(0, 12)
  const tokens = Array.from({ length: n }, () => pick(['a', 'b', 'c', 'component:read', ' pipeline:trigger ', '']))
  const raw = tokens.join(pick(seps))
  const once = parseActions(raw)
  const twice = parseActions(once.join('\n'))
  ok(JSON.stringify(once) === JSON.stringify(twice), `parseActions idempotent raw=${JSON.stringify(raw)}`)
  ok(once.every((s) => s.length > 0 && s.trim() === s), `parseActions clean tokens`)

  const bindings = Array.from({ length: n }, () => ({
    subjectType: pick(['user', 'group', undefined]),
    subjectId: pick(['u1', ' u1 ', 'g2', '', '  ', 'g1']),
  }))
  const ks1 = knownSubjects(bindings)
  const ks2 = knownSubjects(ks1)
  ok(JSON.stringify(ks1) === JSON.stringify(ks2), `knownSubjects idempotent`)
  const keys = ks1.map((b) => `${b.subjectType}:${b.subjectId}`)
  ok(new Set(keys).size === keys.length, `knownSubjects dedup`)
  ok(keys.every((k) => !k.endsWith(':')), `knownSubjects drops empty id`)
}

// ---- 模式三：round-trip（ensureVisible 后目标行必在视口内） ----
for (let i = 0; i < ROUNDS; i++) {
  const rowHeight = int(1, 60)
  // 前提：视口至少能容纳一行，否则"整行可见"物理上不成立（源码优先露出行底是合理降级）。
  const viewportHeight = int(rowHeight, 900)
  const totalRows = int(1, 500)
  const index = int(0, totalRows - 1)
  const scrollTop = int(0, 2000)
  const out = ensureVisible(index, scrollTop, viewportHeight, { rowHeight })
  const top = index * rowHeight
  const bottom = top + rowHeight
  ok(out >= 0, `ensureVisible non-negative`)
  ok(top >= out && bottom <= out + viewportHeight, `row ${index} visible out=${out} top=${top} bottom=${bottom} vh=${viewportHeight}`)
}

// ---- 模式四：等价（flattenVisible 的 index 连续 == 独立计数；state 非 expanded 不下钻） ----
function makeTree(depth, budget) {
  const n = int(0, Math.min(4, budget[0]))
  budget[0] -= n
  return Array.from({ length: n }, (_, i) => ({
    id: `${depth}-${i}-${int(0, 9999)}`,
    name: `n${i}`,
    state: pick(['collapsed', 'loading', 'expanded', 'error']),
    children: depth < 3 ? makeTree(depth + 1, budget) : [],
  }))
}
function countVisible(roots) {
  let c = 0
  for (const node of roots) {
    c++
    if (node.state === 'expanded' && node.children.length) c += countVisible(node.children)
  }
  return c
}
for (let i = 0; i < ROUNDS; i++) {
  const roots = makeTree(0, [30])
  const rows = flattenVisible(roots)
  ok(rows.length === countVisible(roots), `flattenVisible count matches traversal`)
  ok(rows.every((r, idx) => r.index === idx), `flattenVisible index continuous`)
  ok(rows.every((r) => r.depth >= 0), `flattenVisible depth non-negative`)
  // shouldVirtualize 阈值等价：边界两侧行为一致
  const th = int(1, 500)
  ok(shouldVirtualize(th, th) === true, `shouldVirtualize at threshold`)
  ok(shouldVirtualize(th - 1, th) === false, `shouldVirtualize below threshold`)
}

// formatExpiryISO round-trip：合法输入的 ISO 输出可被 Date 还原同一时刻
for (let i = 0; i < ROUNDS; i++) {
  const ms = int(0, 4102444800000) // 1970..2100
  const iso = new Date(ms).toISOString().slice(0, 16) // datetime-local 形态
  const out = formatExpiryISO(iso)
  ok(out !== null, `formatExpiryISO accepts datetime-local`)
  ok(new Date(out).getTime() === new Date(iso).getTime(), `formatExpiryISO round-trip`)
  ok(formatExpiryISO('') === null && formatExpiryISO('nonsense') === null, `formatExpiryISO rejects invalid`)
}

// 相位判定不变量：可取消与终态互斥且穷尽；未知相位一律按终态（保守不给取消入口）。
const ALL_PHASES = ['Pending', 'Running', 'WaitingApproval', 'Succeeded', 'Failed', 'Cancelled', 'Unknown', '']
for (const phase of ALL_PHASES) {
  const cancellable = isRunCancellable(phase)
  const terminal = isRunTerminal(phase)
  ok(cancellable !== terminal, `phase mutually exclusive: ${phase}`)
  ok(terminal === !cancellable, `phase terminal = !cancellable: ${phase}`)
}
ok(['Pending', 'Running', 'WaitingApproval'].every(isRunCancellable), `known cancellable set`)
ok(['Succeeded', 'Failed', 'Cancelled', 'Unknown'].every(isRunTerminal), `known terminal set`)

console.log(`property-test: PASS (${ROUNDS} rounds × 5 groups + phase invariants, ${checks} checks)`)
