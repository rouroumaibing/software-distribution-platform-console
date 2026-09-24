// 运行控制相位策略冒烟：取消 / 单任务重跑的前端准入判定（纯逻辑，直接 import 源码 .ts）。
// 与 hub internal/run/service/run_control.go 的相位 switch 对齐：
//   - 可取消 = Pending / Running / WaitingApproval（其余为终态 -> 后端 409）
//   - 可重跑 = Failed / Skipped
// 跑法：pnpm test:run-control（或直接 node scripts/run-control-smoke.mjs）。
import assert from 'node:assert/strict'
import { isRunCancellable, isRunTerminal, isTaskRerunnable } from '../src/utils/run.ts'

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

// ---- 取消：只有非终态可取消 ----
check('Pending / Running / WaitingApproval 可取消', () => {
  for (const p of ['Pending', 'Running', 'WaitingApproval']) {
    assert.equal(isRunCancellable(p), true, `${p} 应可取消`)
  }
})

check('终态不可取消（Succeeded / Failed / Cancelled）', () => {
  for (const p of ['Succeeded', 'Failed', 'Cancelled']) {
    assert.equal(isRunCancellable(p), false, `${p} 不应可取消`)
    assert.equal(isRunTerminal(p), true, `${p} 应判为终态`)
  }
})

check('isRunTerminal 与 isRunCancellable 恒互补', () => {
  for (const p of ['Pending', 'Running', 'WaitingApproval', 'Succeeded', 'Failed', 'Cancelled']) {
    assert.equal(isRunTerminal(p), !isRunCancellable(p), `相位 ${p} 判定不互补`)
  }
})

// ---- 重跑：失败 / 被跳过 ----
check('Failed / Skipped 可重跑', () => {
  for (const p of ['Failed', 'Skipped']) {
    assert.equal(isTaskRerunnable(p), true, `${p} 应可重跑`)
  }
})

check('Succeeded / Running / Pending 不提供重跑入口', () => {
  for (const p of ['Succeeded', 'Running', 'Pending']) {
    assert.equal(isTaskRerunnable(p), false, `${p} 不应提供重跑`)
  }
})

console.log(`运行控制相位策略冒烟：${pass}/${cases.length} 通过`)
for (const c of cases) console.log(c)
if (pass !== cases.length) process.exit(1)
