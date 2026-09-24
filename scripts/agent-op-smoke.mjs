// agent_ops 消费端契约冒烟：SSE 解析 / 事件解码 / 枚举标签（纯逻辑，直接 import 源码 .ts）。
// 与 scripts/service-tree-smoke.mjs 同一手法：Node ≥22.18 原生类型剥离，测出厂代码本身。
import assert from 'node:assert/strict'
import {
  parseSSERawEvent,
  decodeOpEvent,
  agentOpTypeLabel,
  agentOpStatusLabel,
  isTerminalStatus,
} from '../src/utils/agentOp.ts'

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

// --- parseSSERawEvent ---
check('解析 status 事件块', () => {
  const r = parseSSERawEvent('event: status\ndata: {"status":"running"}\n\n')
  assert.equal(r.event, 'status')
  assert.equal(r.data, '{"status":"running"}')
})

check('解析 log 事件块（多行 data 拼接）', () => {
  const r = parseSSERawEvent('event: log\ndata: line1\ndata: line2\n\n')
  assert.equal(r.event, 'log')
  assert.equal(r.data, 'line1\nline2')
})

check('缺 event 默认 message', () => {
  const r = parseSSERawEvent('data: hello\n\n')
  assert.equal(r.event, 'message')
  assert.equal(r.data, 'hello')
})

check('ping / 注释行被忽略', () => {
  const r = parseSSERawEvent(': ping\n\n')
  assert.equal(r, null) // 只有注释，无字段 → null
})

check('data 前导空格被剥离（SSE 只剥一个）', () => {
  const r = parseSSERawEvent('event: status\ndata: {"a":1}\n\n')
  assert.equal(r.data, '{"a":1}')
})

check('空块返回 null', () => {
  assert.equal(parseSSERawEvent(''), null)
  assert.equal(parseSSERawEvent('\n\n'), null)
})

// --- decodeOpEvent ---
check('解码 status 事件为 OpEvent', () => {
  const ev = decodeOpEvent('status', '{"id":"x","opType":"exec","status":"running","targetId":"t","createdAt":"c","updatedAt":"u"}')
  assert.equal(ev.kind, 'status')
  assert.equal(ev.status.opType, 'exec')
  assert.equal(ev.status.status, 'running')
})

check('解码 log 事件带 seq', () => {
  const ev = decodeOpEvent('log', '{"id":"l","opId":"o","seq":3,"chunk":"hi","createdAt":"c"}')
  assert.equal(ev.kind, 'log')
  assert.equal(ev.log.seq, 3)
  assert.equal(ev.log.chunk, 'hi')
})

check('非法 JSON 的 status 返回 null（不抛）', () => {
  assert.equal(decodeOpEvent('status', 'not-json'), null)
})

check('end 事件返回 null（不进入事件流）', () => {
  assert.equal(decodeOpEvent('end', '{"reason":"terminal"}'), null)
})

check('未知 event 返回 null', () => {
  assert.equal(decodeOpEvent('banana', 'x'), null)
})

// --- 标签 / 终态 ---
check('opType 标签中文映射', () => {
  assert.equal(agentOpTypeLabel('exec'), '命令执行')
  assert.equal(agentOpTypeLabel('install'), '安装 Runner')
  assert.equal(agentOpTypeLabel('upgrade'), '升级 Runner')
})

check('status 标签中文映射', () => {
  assert.equal(agentOpStatusLabel('queued'), '排队中')
  assert.equal(agentOpStatusLabel('running'), '运行中')
  assert.equal(agentOpStatusLabel('succeeded'), '成功')
  assert.equal(agentOpStatusLabel('failed'), '失败')
})

check('isTerminalStatus 仅在 succeeded/failed 为真', () => {
  assert.equal(isTerminalStatus('succeeded'), true)
  assert.equal(isTerminalStatus('failed'), true)
  assert.equal(isTerminalStatus('queued'), false)
  assert.equal(isTerminalStatus('running'), false)
})

const total = cases.length
console.log(`\n接入目标操作台账 纯逻辑冒烟：${pass}/${total} 通过`)
for (const c of cases) console.log(c)
if (pass !== total) {
  console.log('\nFAIL')
  process.exit(1)
}
console.log('')
