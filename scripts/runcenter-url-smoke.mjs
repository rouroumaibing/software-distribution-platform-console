// 运行中心三视图 URL 契约冒烟（附 B B.6 硬约束 ①③ / B.7 gate）。
// 跑法：pnpm test:runcenter（或直接 node scripts/runcenter-url-smoke.mjs）。
// 直接 import 源码 src/constants/runCenter.ts（Node ≥22.18 原生类型剥离）——
// 测的是出厂代码本身，不是复制品。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canonicalRunQuery,
  runQueryParams,
  sameQuery,
  runViewLabel,
  RUN_VIEWS,
  getRunView,
  isRunViewKey,
} from '../src/constants/runCenter.ts'

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

// ---- ① 缺省归一化：地址栏只有一种形态 ----
check('裸 /runs → ?view=runs', () => {
  const q = canonicalRunQuery({})
  assert.deepEqual(q, { view: 'runs', phase: '', page: 1 })
  assert.deepEqual(runQueryParams(q), { view: 'runs' })
})

check('?view=bogus → 回落 runs', () => {
  const q = canonicalRunQuery({ view: 'bogus' })
  assert.equal(q.view, 'runs')
  assert.equal(runViewLabel(q.view), '运行')
})

check('深链完整形态原样保留', () => {
  const q = canonicalRunQuery({ view: 'releases', phase: 'Running', page: '2' })
  assert.deepEqual(q, { view: 'releases', phase: 'Running', page: 2 })
  assert.deepEqual(runQueryParams(q), { view: 'releases', phase: 'Running', page: '2' })
})

check('视图/筛选混搭被丢弃（?view=pipelines&phase=Failed）', () => {
  const q = canonicalRunQuery({ view: 'pipelines', phase: 'Failed' })
  assert.deepEqual(runQueryParams(q), { view: 'pipelines' })
})

check('视图内合法筛选保留（?view=pipelines&phase=build）', () => {
  const q = canonicalRunQuery({ view: 'pipelines', phase: 'build' })
  assert.deepEqual(runQueryParams(q), { view: 'pipelines', phase: 'build' })
})

check('非法 page（0 / abc / 1.7）回落到 1 或取整', () => {
  assert.equal(canonicalRunQuery({ page: '0' }).page, 1)
  assert.equal(canonicalRunQuery({ page: 'abc' }).page, 1)
  assert.equal(canonicalRunQuery({ page: '1.7' }).page, 1)
  assert.equal(canonicalRunQuery({ page: '3' }).page, 3)
  assert.equal('page' in runQueryParams(canonicalRunQuery({ page: '1' })), false)
})

check('归一化幂等（replace 不会自我循环）', () => {
  const inputs = [
    {},
    { view: 'bogus' },
    { view: 'releases' },
    { view: 'releases', phase: 'Running', page: '2' },
    { view: 'pipelines', phase: 'Failed' },
    { page: '0' },
    { view: 'runs', phase: '', page: '1' },
  ]
  for (const input of inputs) {
    const once = canonicalRunQuery(input)
    const twice = canonicalRunQuery(runQueryParams(once))
    assert.deepEqual(twice, once, `not idempotent for ${JSON.stringify(input)}`)
    // 第二次的参数序列化也必须完全相同（否则 watch 会在两个形态间抖动）
    assert.ok(sameQuery(runQueryParams(once), runQueryParams(twice)))
  }
})

check('?phase=paused 不被接受（Paused 是 Rollout 任务级状态，不是 run phase）', () => {
  const q = canonicalRunQuery({ view: 'releases', phase: 'paused' })
  assert.equal(q.phase, '')
})

// ---- ② 面包屑同源 ----
check('面包屑第二段来自 RUN_VIEWS', () => {
  assert.equal(runViewLabel('runs'), '运行')
  assert.equal(runViewLabel('pipelines'), '流水线')
  assert.equal(runViewLabel('releases'), '发布')
  assert.equal(runViewLabel(undefined), '运行')
})

// ---- 视图定义不变量 ----
check('恰好 3 个视图，顺序与命名固定', () => {
  assert.deepEqual(
    RUN_VIEWS.map((v) => v.key),
    ['runs', 'pipelines', 'releases'],
  )
  assert.deepEqual(
    RUN_VIEWS.map((v) => v.label),
    ['运行', '流水线', '发布'],
  )
})

check('每个视图筛选项首个是「全部」且 value 唯一', () => {
  for (const v of RUN_VIEWS) {
    assert.equal(v.filters[0].value, '')
    assert.equal(v.filters[0].label, '全部')
    const vals = v.filters.map((f) => f.value)
    assert.equal(new Set(vals).size, vals.length, `${v.key} 有重复筛选项`)
    assert.equal(new Set(v.filters.map((f) => f.label)).size, vals.length, `${v.key} 标签重复`)
  }
})

check('筛选值只落在真实枚举内（run phase / pipeline kind）', () => {
  const PHASES = ['Pending', 'Running', 'WaitingApproval', 'Succeeded', 'Failed', 'Cancelled']
  const KINDS = ['build', 'release', 'custom']
  assert.deepEqual(getRunView('runs').filters.map((f) => f.value), ['', 'Running', 'Failed', 'WaitingApproval', 'Succeeded'])
  assert.deepEqual(getRunView('releases').filters.map((f) => f.value), ['', 'Running', 'WaitingApproval', 'Succeeded', 'Failed'])
  assert.deepEqual(getRunView('pipelines').filters.map((f) => f.value), ['', 'build', 'release', 'custom'])
  for (const v of RUN_VIEWS) {
    const allowed = v.key === 'pipelines' ? KINDS : PHASES
    for (const f of v.filters) {
      if (f.value !== '') assert.ok(allowed.includes(f.value), `${v.key}.${f.value} 不在真实枚举内`)
    }
  }
})

check('isRunViewKey 只认真实 key', () => {
  assert.equal(isRunViewKey('runs'), true)
  assert.equal(isRunViewKey('nope'), false)
  assert.equal(isRunViewKey(['runs']), false)
  assert.equal(isRunViewKey(undefined), false)
})

// ---- ⑤ 旧链迁移：/pipelines、/releases 落到对应视图而不是笼统回 /runs ----
// 静态断言（router/index.ts 用 createWebHistory，装载需要 DOM，node 里跑不起来）：
// 保证「点发布旧链看到运行列表」这个静默语义漂移不会回归。
check('旧 flat 路由 redirect 指向对应视图（静态断言）', () => {
  const src = readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.ok(
    src.includes("path: 'pipelines', redirect: { path: '/runs', query: { view: 'pipelines' } }"),
    "/pipelines 未 redirect 到 /runs?view=pipelines",
  )
  assert.ok(
    src.includes("path: 'releases', redirect: { path: '/runs', query: { view: 'releases' } }"),
    "/releases 未 redirect 到 /runs?view=releases",
  )
})

console.log(cases.join('\n'))
console.log(`\n${pass}/${cases.length} passed`)
process.exit(pass === cases.length ? 0 : 1)
