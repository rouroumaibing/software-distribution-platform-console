#!/usr/bin/env node
// console 业务链路 E2E（UI-F）：验证真实运行数据在运行监控 / 组件详情的呈现。
// 真实触发与执行由 hub+runner 完成（见 evidence/e2e-fixtures.json）。
// 判定由 contract-runner 依据 criteria.mjs 契约完成。
// 用法：node scripts/e2e-flows.mjs
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, openSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSuite } from './contract-runner.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9227)
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const USER = process.env.E2E_USER || 'admin'
const PASS = process.env.E2E_PASS || 'Sdp@12345x'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(REPO, 'evidence', STAMP)
const FIX = JSON.parse(readFileSync(path.join(REPO, 'evidence', 'e2e-fixtures.json'), 'utf8'))
const CASE_IDS = ['UI-F01', 'UI-F02', 'UI-F03', 'UI-F04', 'UI-F05', 'UI-F06']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const children = []
const cleanup = () => { for (const c of children) { try { process.kill(-c.pid, 'SIGTERM') } catch {} } }
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130) })

function spawnDetached(cmd, args, logPath) {
  mkdirSync(path.dirname(logPath), { recursive: true })
  const out = openSync(logPath, 'a')
  const c = spawn(cmd, args, { cwd: REPO, detached: true, stdio: ['ignore', out, out] })
  children.push(c); return c
}
async function waitFor(url, tries = 60, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true } catch {}
    await sleep(gap)
  }
  return false
}

const suite = createSuite({
  suite: 'UI-F', caseIds: CASE_IDS, stamp: STAMP, out: OUT, base: BASE,
  auth: { user: USER, mode: 'cookie' }, fixtureRun: FIX.run,
  chain: 'real run(hub+runner) -> cdp browser -> dom+api observations -> contract verdict -> evidence',
})

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true })
  suite.say('=== UI-F 业务链路（判定来自 criteria.mjs 契约）===')

  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }), signal: AbortSignal.timeout(15000),
  })
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0]
  if (lr.status !== 200 || !cookie.startsWith('sdp_sess=')) throw new Error(`登录失败 HTTP ${lr.status}`)
  suite.say('登录 OK')

  spawnDetached(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--ignore-certificate-errors',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/sdp-flows-${STAMP}`, 'about:blank',
  ], path.join(OUT, 'chrome.log'))
  if (!await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`)) throw new Error('CDP 未就绪')
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const target = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let id = 0; const pending = new Map()
  const apiLog = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response
      try { const u = new URL(r.url); if (u.pathname.startsWith('/api/')) apiLog.push({ path: u.pathname + u.search, status: r.status }) } catch {}
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(n, (m) => { clearTimeout(timer); resolve(m) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Network.setCookie', { name: 'sdp_sess', value: cookie.slice(cookie.indexOf('=') + 1), domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
  const nav = async (p) => {
    apiLog.length = 0
    await send('Page.navigate', { url: BASE + p })
    for (let i = 0; i < 40; i++) { if (await evalJs('document.readyState') === 'complete') break; await sleep(150) }
    await sleep(1100)
    return { url: await evalJs('location.href'), text: (await evalJs('document.body.innerText')) || '', api: apiLog.slice() }
  }
  const shot = async (label) => {
    const d = (await send('Page.captureScreenshot', { format: 'png' })).result?.data || ''
    const buf = Buffer.from(d, 'base64')
    const p = path.join(OUT, 'screenshots', `${label}.png`)
    writeFileSync(p, buf)
    return { path: p, sha256: createHash('sha256').update(buf).digest('hex') }
  }

  // F01 环境准备：组件与环境在树/列表可见可选
  const f1a = await nav(`/components/${FIX.component.id}/overview`)
  const f1b = await nav(`/components/${FIX.component.id}/environments`)
  const s1 = await shot('F01-component-env')
  await suite.run('UI-F01', '组件概览与环境可见', () => ({
    text: f1a.text + '\n' + f1b.text, apiCalls: f1a.api.concat(f1b.api),
    flags: {
      componentVisible: f1a.text.includes(FIX.component.name) && f1a.api.some((a) => a.path.includes('/components/') && a.status === 200),
      envVisible: f1b.url.includes('/environments') && f1b.api.some((a) => a.status >= 200 && a.status < 400),
    },
  }), { screenshot: s1 })

  // F02 日常流水线：真实 Succeeded 运行的阶段/部署/日志区呈现
  const f2 = await nav(`/pipelines/${FIX.pipeline.id}/runs/${FIX.run.id}`)
  const s2 = await shot('F02-monitor')
  await suite.run('UI-F02', '日常流水线运行监控', () => ({
    text: f2.text, apiCalls: f2.api,
    flags: {
      stageGreen: f2.text.includes('构建') && /成功|Succeeded/.test(f2.text),
      deployed: /部署|测试/.test(f2.text),
      logVisible: /日志|输出/.test(f2.text) || f2.api.some((a) => /logs?/.test(a.path)),
    },
  }), { screenshot: s2, probe: { run: FIX.run.name, phase: FIX.run.finalPhase } })

  // F03~F05 属结构缺失：前端无 Test 类型、无版本归档/转测/生产专用编排入口（kind 仅分类标签），
  // 无法靠造数补齐业务语义，转缺陷清单，不静默跳过。
  suite.skip('UI-F03', '版本归档流水线', '前端无归档任务类型/专用入口，kind 仅标签——结构缺陷，转缺陷清单')
  suite.skip('UI-F04', '转测流水线', '前端无版本包消费/转测发布入口——结构缺陷，转缺陷清单')
  suite.skip('UI-F05', '生产流水线', '前端无审批门禁+多环境发布编排入口——结构缺陷，转缺陷清单')

  // F06 异常回归：失败 fixture（已造）+ UI 重跑任务（rerun API）+ 灰度回滚（rollout API）。
  const f6a = await nav(`/pipelines/${FIX.pipeline.id}/runs/${FIX.failedRun.id}`)
  const failureInjected = f6a.text.includes('Failed') || f6a.text.includes('失败')
  const rerunClicked = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('重跑任务')&&!x.disabled);if(!b)return false;b.click();return true})()`)
  await new Promise((r) => setTimeout(r, 900))
  const rerunApi = apiLog.some((a) => /\/rerun/.test(a.path) && a.status >= 200 && a.status < 400)
  // 回滚：ReleaseDetail 的 ↩ 回滚走 HighRiskConfirm
  const f6b = await nav(`/releases/${FIX.releaseRun.id}`)
  const rbClicked = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('回滚')&&!x.disabled);if(!b)return false;b.click();return true})()`)
  await new Promise((r) => setTimeout(r, 600))
  await evalJs(`(()=>{const t=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent!==null);if(t){const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'e2e rollback');t.dispatchEvent(new Event('input',{bubbles:true}))}return true})()`)
  await new Promise((r) => setTimeout(r, 250))
  const rbConfirmed = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('确认')&&x.offsetParent!==null);if(!b)return false;b.click();return true})()`)
  await new Promise((r) => setTimeout(r, 900))
  const rollbackApi = apiLog.some((a) => /\/rollout/.test(a.path) && a.status >= 200 && a.status < 400)
  const s6f = await shot('F06-retry-rollback')
  await suite.run('UI-F06', '异常回归（重跑 + 回滚）', () => ({
    text: f6a.text + ' || ' + f6b.text, apiCalls: apiLog.slice(),
    flags: { failureInjected, retried: rerunClicked && rerunApi, rolledBack: rbClicked && rbConfirmed && rollbackApi },
  }), { screenshot: s6f, probe: { rerunClicked, rerunApi, rbClicked, rbConfirmed, rollbackApi } })

  ws.close()
  suite.finish()
}

main().catch((e) => { console.error('FLOW ERROR:', e.message); process.exitCode = 1 }).finally(() => cleanup())
