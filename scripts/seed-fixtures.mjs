#!/usr/bin/env node
// console UI E2E 造数：为「前端已实现、只差后端状态」的用例补齐 fixture。
// 原则：API 能造的用 hub API；run/task 的 broker-only 状态用 PG 直写 fixture
// （与 API 造数同性质，断言仍是真实 DOM + API 行为）。脚本幂等，可重复执行。
// 用法：node scripts/seed-fixtures.mjs
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
const KUBECONFIG = process.env.KUBECONFIG || path.resolve(REPO, '..', '.kubeconfig')
const NS = 'sdp-workflow'
const PG_POD = process.env.PG_POD || 'postgres-646f584b8f-lb76k'
const USER = process.env.E2E_USER || 'admin'
const PASS = process.env.E2E_PASS || 'Sdp@12345x'
const FIX_PATH = path.join(REPO, 'evidence', 'e2e-fixtures.json')

const api = async (m, p, body, cookie) => {
  const h = { 'Content-Type': 'application/json' }
  if (cookie) h.Cookie = cookie
  const r = await fetch(BASE + '/api/v1' + p, {
    method: m, headers: h, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: r.status, data: d, cookie: r.headers.get('set-cookie') }
}

const psql = (sql) => {
  const out = execFileSync('kubectl', [
    '-n', NS, 'exec', PG_POD, '--', 'psql', '-U', 'sdp', '-d', 'sdp', '-t', '-A', '-c', sql,
  ], { env: { ...process.env, KUBECONFIG }, encoding: 'utf8' })
  return out.trim().split('\n').filter(Boolean)
}

const UUID = () => randomUUID()

async function main() {
  // 清理上一轮 B07 UI 测试新建的临时流水线：每轮新建会让 dashboard 对每个 pipeline
  // 串行发 runs 请求，累积后拖慢首屏并使五态用例超时。按固定前缀清理，保证幂等。
  const tmpPipelines = psql(`select id from pipelines where name like 'e2e-crud-%' and deleted_at is null`)
  for (const id of tmpPipelines) {
    psql(`update pipelines set deleted_at=now() where id='${id}'`)
    psql(`delete from pipeline_stages where pipeline_id='${id}'`)
  }
  if (tmpPipelines.length) console.log(`清理临时流水线 ${tmpPipelines.length} 条`)
  let fix = existsSync(FIX_PATH) ? JSON.parse(readFileSync(FIX_PATH, 'utf8')) : {}
  const lr = await api('POST', '/auth/login', { username: USER, password: PASS })
  if (lr.status !== 200) throw new Error(`登录失败 ${lr.status}`)
  const cookie = lr.cookie.split(';')[0]
  const org = fix.org?.id || psql('select id from orgs limit 1')[0]
  const tree = fix.serviceTree?.id || psql('select id from service_trees limit 1')[0]
  const comp = fix.component?.id || psql('select id from components limit 1')[0]
  const target = psql('select id from targets order by name limit 1')[0]
  const pipeline = fix.pipeline?.id || psql('select id from pipelines limit 1')[0]
  const stage = fix.stage?.id || psql(`select id from pipeline_stages where pipeline_id='${pipeline}' order by sequence limit 1`)[0]

  // ---- 1. paused release（API，幂等：按 workloadRef 查重）----
  let releaseId = psql(`select id from rollout_runs where workload_ref='deploy/gateway-e2e' limit 1`)[0]
  if (!releaseId) {
    const helloTask = psql(`select id from task_runs where task_name='hello' order by created_at desc limit 1`)[0]
    const rr = await api('POST', '/releases', {
      taskRunId: helloTask, workloadRef: 'deploy/gateway-e2e', phase: 'Paused',
      currentStepIndex: 0, currentWeight: 20,
    }, cookie)
    if (rr.status !== 201) throw new Error(`造 release 失败 ${rr.status}: ${JSON.stringify(rr.data)}`)
    releaseId = rr.data.data.id
  }
  console.log(`paused release: ${releaseId}`)

  // ---- 2. Release 类型 taskRun（PG 直写 fixture，支撑 B09 控制键）----
  // 复用现有 Succeeded run，插一条进行中的 Release taskRun + 一个独立 rollout 快照。
  const relRunId = fix.releaseRun?.id || UUID()
  const relTaskId = fix.releaseRun?.taskId || UUID()
  if (!psql(`select id from pipeline_runs where id='${relRunId}'`)[0]) {
    psql(`insert into pipeline_runs (id, pipeline_id, target_id, org_id, cr_name, cr_namespace, params, phase, timeout_seconds, trigger_source, created_at, updated_at)
          values ('${relRunId}', '${pipeline}', '${target}', '${org}', 'pr-release-e2e', 'sdp-run', '[]'::jsonb, 'Running', 0, 'manual', now(), now())`)
  }
  if (!psql(`select id from task_runs where id='${relTaskId}'`)[0]) {
    psql(`insert into task_runs (id, pipeline_run_id, cr_name, task_name, stage_name, type, phase, created_at, updated_at)
          values ('${relTaskId}', '${relRunId}', 'pr-release-e2e', 'canary-deploy', '发布', 'Release', 'Running', now(), now())`)
  }
  const relSnapId = UUID()
  if (!psql(`select id from rollout_runs where id='${relSnapId}'`)[0]) {
    psql(`insert into rollout_runs (id, task_run_id, workload_ref, phase, current_step_index, current_weight)
          values ('${relSnapId}', '${relTaskId}', 'deploy/canary-e2e', 'Paused', 0, 20)`)
  }
  console.log(`release run: ${relRunId} task=${relTaskId}`)

  // ---- 3. Approval 待审批运行（PG 直写，支撑 B10 + B08 待审批卡 + S07）----
  const aprRunId = fix.approvalRun?.id || UUID()
  const aprTaskId = UUID()
  if (!psql(`select id from pipeline_runs where id='${aprRunId}'`)[0]) {
    psql(`insert into pipeline_runs (id, pipeline_id, target_id, org_id, cr_name, cr_namespace, params, phase, timeout_seconds, trigger_source, created_at, updated_at)
          values ('${aprRunId}', '${pipeline}', '${target}', '${org}', 'pr-approval-e2e', 'sdp-run', '[]'::jsonb, 'WaitingApproval', 0, 'manual', now(), now())`)
    psql(`insert into task_runs (id, pipeline_run_id, cr_name, task_name, stage_name, type, phase, created_at, updated_at)
          values ('${aprTaskId}', '${aprRunId}', 'pr-approval-e2e', 'gate-approval', '审批', 'Approval', 'WaitingApproval', now(), now())`)
    // requested_by 用非 admin，避免前端 admin 审批命中 hub 自审禁止（B10 需要能真提交）。
    psql(`insert into pipeline_approvals (id, org_id, run_id, task_run_id, component_id, pipeline_id, status, requested_by, assignee, created_at)
          values ('${UUID()}', '${org}', '${aprRunId}', '${aprTaskId}', '${comp}', '${pipeline}', 'Pending', 'e2e-requester', 'admin', now())`)
    psql(`update task_runs set message='requested_by=e2e-requester' where id='${aprTaskId}'`)
  }
  // 每次 seed 都重置审批 fixture 为可决策态（decision 会把 Pending 改为终态）。
  psql(`update pipeline_approvals set requested_by='e2e-requester', status='Pending', decided_at=null, approver=null, decision_comment=null where run_id='${aprRunId}'`)
  psql(`update task_runs set phase='WaitingApproval' where id='${aprTaskId}'`)
  psql(`update pipeline_runs set phase='WaitingApproval' where id='${aprRunId}'`)
  console.log(`approval run: ${aprRunId} task=${aprTaskId}`)

  // ---- 4. 失败运行（PG 直写，支撑 B08 失败卡 + F06）----
  const failRunId = fix.failedRun?.id || UUID()
  const failTaskId = UUID()
  if (!psql(`select id from pipeline_runs where id='${failRunId}'`)[0]) {
    psql(`insert into pipeline_runs (id, pipeline_id, target_id, org_id, cr_name, cr_namespace, params, phase, timeout_seconds, trigger_source, message, created_at, updated_at)
          values ('${failRunId}', '${pipeline}', '${target}', '${org}', 'pr-failed-e2e', 'sdp-run', '[]'::jsonb, 'Failed', 0, 'manual', 'e2e injected failure', now(), now())`)
    psql(`insert into task_runs (id, pipeline_run_id, cr_name, task_name, stage_name, type, phase, exit_code, message, created_at, updated_at)
          values ('${failTaskId}', '${failRunId}', 'pr-failed-e2e', 'failing-build', '构建', 'Build', 'Failed', 1, 'e2e injected failure', now(), now())`)
  }
  console.log(`failed run: ${failRunId}`)

  // ---- 5. 多余 service（支撑 B03 多层/虚拟滚动数据基础）----
  for (const [k, n] of [['svc-e2e-b', 'E2E 服务 B'], ['svc-e2e-c', 'E2E 服务 C']]) {
    if (!psql(`select id from services where key='${k}'`)[0]) {
      psql(`insert into services (id, created_at, updated_at, service_tree_id, key, name, description, owner_team)
            values ('${UUID()}', now(), now(), '${tree}', '${k}', '${n}', 'e2e seed', 'e2e')`)
    }
  }
  console.log('services seeded')

  // 落盘 fixtures（合并，不覆盖已有字段）
  fix.seededAt = new Date().toISOString()
  fix.releaseRun = { id: relRunId, taskId: relTaskId, taskName: 'canary-deploy', releaseId: releaseId }
  fix.approvalRun = { id: aprRunId, taskId: aprTaskId, taskName: 'gate-approval' }
  fix.failedRun = { id: failRunId, taskId: failTaskId }
  writeFileSync(FIX_PATH, JSON.stringify(fix, null, 2) + '\n')
  console.log(`fixtures 已更新: ${FIX_PATH}`)
}

main().catch((e) => { console.error('SEED ERROR:', e.message); process.exitCode = 1 })
