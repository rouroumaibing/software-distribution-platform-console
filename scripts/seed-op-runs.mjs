#!/usr/bin/env node
// UI 下发逻辑验证 · A/B 类运行用例的幂等造数：重置审批/取消/重投 fixture 到可操作态。
// 这些用例依赖特定 phase；多轮测试会消耗初始状态，故每轮前用 PG 直写重置（测试造数，非产品操作）。
// 用法：node scripts/seed-op-runs.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KUBECONFIG = process.env.KUBECONFIG || path.resolve(REPO, '..', '.kubeconfig')
const PG_POD = process.env.PG_POD || 'postgres-646f584b8f-lb76k'
const FIX = JSON.parse(readFileSync(path.join(REPO, 'evidence', 'e2e-fixtures.json'), 'utf8'))

const pg = (sql) => execFileSync('kubectl', [
  '-n', 'sdp-workflow', 'exec', PG_POD, '--', 'psql', '-U', 'sdp', '-d', 'sdp', '-t', '-A', '-c', sql,
], { env: { ...process.env, KUBECONFIG }, encoding: 'utf8' }).trim()

const aprRun = FIX.approvalRun.id
const cancelRun = FIX.run.id // succeeded run 重置为 Running 供取消
const failedRun = FIX.failedRun.id

// 审批：Pending + 任务 WaitingApproval + run WaitingApproval
pg(`update pipeline_approvals set status='Pending', approver=null, decided_at=null, decision_comment=null, requested_by='e2e-requester' where run_id='${aprRun}'`)
pg(`update task_runs set phase='WaitingApproval' where pipeline_run_id='${aprRun}'`)
pg(`update pipeline_runs set phase='WaitingApproval', completion_time=null where id='${aprRun}'`)

// 取消：Running + 任务 Running
pg(`update pipeline_runs set phase='Running', completion_time=null, message='' where id='${cancelRun}'`)
pg(`update task_runs set phase='Running' where pipeline_run_id='${cancelRun}'`)

// 重投：Failed（有错误信息触发按钮）+ dispatch record（hub redispatch 要求 run 曾有 dispatch）
pg(`update pipeline_runs set phase='Failed', message='e2e redispatch fixture' where id='${failedRun}'`)
const hasDispatch = pg(`select count(*) from dispatch_jobs where pipeline_run_id='${failedRun}'`)
if (hasDispatch === '0') {
  const src = pg(`select payload from dispatch_jobs where pipeline_run_id='${cancelRun}' limit 1`).split('\n')[0]
  pg(`insert into dispatch_jobs (id,pipeline_run_id,target_id,payload,state,attempts,created_at,updated_at) values (gen_random_uuid(),'${failedRun}','a5604395-f27c-466a-8104-4676810ea17c','${src.replace(/'/g, "''")}','failed',1,now(),now())`)
}

console.log('OP runs seeded:', JSON.stringify({ aprRun, cancelRun, failedRun }))
console.log('states:', pg(`select id,phase from pipeline_runs where id in ('${aprRun}','${cancelRun}','${failedRun}')`).split('\n').join(' | '))
