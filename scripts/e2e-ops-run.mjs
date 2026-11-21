#!/usr/bin/env node
// UI 下发逻辑验证 · 运行/审批/灰度域：OP-33~38。
// A 类（触发运行/审批）断同步落库；B 类（取消/重跑/重新投递/灰度）hub 零写库或靠回流，
// 只断「请求发出 + 2xx + 无 JS 异常」，真实 phase 列为 asyncObserve，禁止用 UI 反馈证明下发。
// 用法：node scripts/e2e-ops-run.mjs
import { boot, finish, loadFixture } from './op-fixtures.mjs'

const FIX = loadFixture()
const PID = FIX.pipeline.id
const CID = FIX.component.id

async function main() {
  const { ui, sub } = await boot('UI-OP-RUN')
  const now = Date.now()

  // ---- OP-33 触发运行（A 类：pipeline_runs 新行 + dispatch_jobs 入队） ----
  const targetId = ui.pg(`select id from targets limit 1`)[0]
  const runsBefore = Number(ui.pg(`select count(*) from pipeline_runs where pipeline_id='${PID}'`)[0] || 0)
  await ui.nav(`/pipelines/${PID}`)
  await ui.clickText('▶ 触发运行', 'button')
  await ui.sleep(400)
  const triggerFilled = await ui.evalJs(`(()=>{const s=[...document.querySelectorAll('.modal select')].find(x=>[...x.options].some(opt=>(opt.textContent||'').includes('local-dev')));if(!s)return false;const opt=[...s.options].find(x=>(x.textContent||'').includes('local-dev'));if(!opt)return false;s.value=opt.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await ui.clickText('▶ 触发', 'button')
  await ui.sleep(1200)
  const runsAfter = Number(ui.pg(`select count(*) from pipeline_runs where pipeline_id='${PID}'`)[0] || 0)
  const trigReq = ui.apiLog.find((a) => a.method === 'POST' && new RegExp(`/pipelines/${PID}/runs(\\?|$)`).test(a.path))
  await ui.run('OP-33', '触发运行（pipeline_runs 新行）', () => ({
    requestOk: !!trigReq && trigReq.status >= 200 && trigReq.status < 400,
    backendChanged: runsAfter > runsBefore,
    uiReflected: triggerFilled,
    before: { runs: runsBefore }, after: { runs: runsAfter }, request: trigReq,
    probe: { targetId, triggerFilled, trigReqBody: trigReq?.body },
    asyncObserve: 'phase 推进 + dispatch 消费靠 runner 回流，不在本用例断言',
  }))

  // ---- OP-34 审批决策（A 类：pipeline_approvals.status 同步写；用 seed 的 WaitingApproval run） ----
  const apr = JSON.parse((await import('node:fs')).readFileSync('/Users/rouroumaibing/work/devops/software-distribution-platform-console/evidence/e2e-fixtures.json', 'utf8'))
  const aprRun = apr.approvalRun?.id || null
  if (aprRun) {
    const aprBefore = ui.pg(`select status,decided_at from pipeline_approvals where run_id='${aprRun}' order by created_at desc limit 1`)
    await ui.nav(`/pipelines/${PID}/runs/${aprRun}`)
    await ui.sleep(600)
    const decBtn = await ui.clickText('审批决策', 'button')
    await ui.sleep(300)
    const approved = await ui.clickText('✓ 批准', 'button')
    await ui.sleep(1000)
    const aprAfter = ui.pg(`select status,decided_at,approver from pipeline_approvals where run_id='${aprRun}' order by created_at desc limit 1`)
    const decReq = ui.apiLog.find((a) => a.method === 'POST' && /\/decision/.test(a.path))
    await ui.run('OP-34', '审批决策（pipeline_approvals.status 同步落库）', () => ({
      requestOk: !!decReq && decReq.status >= 200 && decReq.status < 400,
      backendChanged: aprAfter.length > 0 && aprAfter[0].split('|')[0] !== 'Pending',
      uiReflected: decBtn && approved,
      before: { row: aprBefore }, after: { row: aprAfter }, request: decReq,
      probe: { aprRun, decBtn, approved },
      asyncObserve: '任务放行靠 runner 回流；自审禁止由 hub 后端校验',
    }))
  }

  // ---- B 类通用：导航到运行监控页，执行操作，只断请求 200 + 无 JS 异常 ----
  const runId = apr.run?.id || null
  const bcase = async (id, name, navPath, action, reqPattern) => {
    if (!runId && id !== 'OP-38') { ui.say(`  SKIP ${id}: 无可用 run fixture`); return }
    await ui.nav(navPath)
    await ui.sleep(600)
    const beforeReq = ui.apiLog.length
    const acted = await action()
    await ui.sleep(1000)
    const req = ui.apiLog.slice(beforeReq).find((a) => reqPattern.test(a.path))
    await ui.run(id, name, () => ({
      requestOk: !!req && req.status >= 200 && req.status < 400,
      backendChanged: false, // B 类不适用：hub 零写库 / 状态靠回流
      uiReflected: acted,
      request: req, probe: { runId, acted },
      asyncObserve: '真实 phase/权重由 runner 回流写；本判据只用「请求发出且无错」证明下发',
    }), { kind: 'B' })
  }

  // OP-35 取消运行：两段式内联确认（点两次）
  await bcase('OP-35', '取消运行（B：请求200）', `/pipelines/${PID}/runs/${runId}`, async () => {
    const c1 = await ui.clickText('取消运行', 'button')
    await ui.sleep(200)
    const c2 = await ui.clickText('确认取消？', 'button')
    return c1 && c2
  }, /\/runs\/[^/]+\/cancel/)

  // OP-36 单任务重跑（需先点选一个 Failed/Skipped 任务节点——fixture failedRun）
  const failedRun = apr.failedRun?.id || null
  if (failedRun) {
    await bcase('OP-36', '单任务重跑（B：请求200）', `/pipelines/${PID}/runs/${failedRun}`, async () => {
      const nodeClicked = await ui.evalJs(`(()=>{const n=[...document.querySelectorAll('.node')].find(x=>x.offsetParent!==null);if(!n)return false;n.click();return true})()`)
      await ui.sleep(200)
      const rerun = await ui.clickText('↻ 重跑任务（含下游）', 'button')
      return nodeClicked && rerun
    }, /\/runs\/[^/]+\/tasks\/[^/]+\/rerun/)
  } else {
    ui.say('  SKIP OP-36: 无 Failed run fixture')
  }

  // OP-37 重新投递（Failed run 上的按钮）
  if (failedRun) {
    await bcase('OP-37', '重新投递（B：请求200）', `/pipelines/${PID}/runs/${failedRun}`, async () => {
      return ui.clickText('↻ 重新投递', 'button')
    }, /\/runs\/[^/]+\/redispatch/)
  }

  // OP-38 灰度 pause（B：无高危确认，直接下发；用 seed 的 paused release）
  const relRun = apr.releaseRun?.id || null
  if (relRun) {
    await bcase('OP-38', '灰度 pause（B：请求200）', `/releases/${relRun}`, async () => {
      return ui.clickText('⏸ 暂停', 'button')
    }, /\/rollout/)
  } else {
    // 无 release fixture：从 PG 找一个 Running release run
    const rr = ui.pg(`select run_id from release_runs where phase='Running' limit 1`)[0]
    if (rr) {
      await bcase('OP-38', '灰度 pause（B：请求200）', `/releases/${rr}`, async () => {
        return ui.clickText('⏸ 暂停', 'button')
      }, /\/rollout/)
    } else {
      ui.say('  SKIP OP-38: 无 Running release 可用')
    }
  }

  finish(ui, 'UI-OP-RUN', { note: '第五批：运行/审批/灰度（A 同步落库 + B 纯下发）', fixture: { pipelineId: PID } })
}

main().catch((e) => { console.error('OP RUN ERROR:', e.message); process.exitCode = 1 })
