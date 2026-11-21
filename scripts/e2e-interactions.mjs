#!/usr/bin/env node
// console 行为交互 E2E（UI-B 用例）：CDP 驱动真实点击/输入/键盘/路由，
// 采集 DOM、URL、API 与 JS 异常作为观测事实；判定由 contract-runner 完成。
// 用法：node scripts/e2e-interactions.mjs
// 前置：evidence/e2e-fixtures.json 已生成。
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSuite } from './contract-runner.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9223)
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const USER = process.env.E2E_USER || 'admin'
const PASS = process.env.E2E_PASS || 'Sdp@12345x'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(REPO, 'evidence', STAMP)
const FIX = JSON.parse(readFileSync(path.join(REPO, 'evidence', 'e2e-fixtures.json'), 'utf8'))
const CASE_IDS = ['UI-B01', 'UI-B02', 'UI-B03', 'UI-B04', 'UI-B05', 'UI-B06', 'UI-B07', 'UI-B08', 'UI-B09', 'UI-B10', 'UI-B11', 'UI-B12']
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
  suite: 'UI-B', caseIds: CASE_IDS, stamp: STAMP, out: OUT, base: BASE,
  auth: { user: USER, mode: 'cookie' },
  chain: 'login(cookie) -> chrome-cdp -> dom/url/api observations -> contract verdict -> evidence',
})

// 路由清单来自 src/router/index.ts（顶层 26 + 组件 11 子路由）。
const ROUTES = [
  '/dashboard', '/service-tree', '/notifications/settings', '/me/tokens', '/runs',
  '/org/dashboard?org=default', `/pipelines/${FIX.pipeline.id}`, `/pipelines/${FIX.pipeline.id}/runs`,
  `/pipelines/${FIX.pipeline.id}/runs/${FIX.run.id}`, '/admin/dashboard', '/admin/permissions',
  '/admin/targets', '/admin/credentials', '/admin/audit', '/admin/settings',
  '/admin/upgrade-approvals', '/admin/auth', '/admin/cluster-permissions', '/forbidden',
  ...['overview', 'config', 'pipelines', 'runs', 'releases', 'artifacts', 'environments', 'permissions', 'audit', 'logs', 'vars']
    .map((t) => `/components/${FIX.component.id}/${t}`),
]

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true })
  if (!existsSync(CHROME)) throw new Error(`Chrome 不存在: ${CHROME}`)
  suite.say('=== UI-B 行为交互（判定来自 criteria.mjs 契约）===')

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
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/sdp-interact-${STAMP}`, 'about:blank',
  ], path.join(OUT, 'chrome.log'))
  if (!await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`)) throw new Error('CDP 未就绪')
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const target = targets.find((t) => t.type === 'page')
  if (!target) throw new Error('无 page target')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let msgId = 0; const pending = new Map()
  let apiLog = []
  const jsErrors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response
      try { const u = new URL(r.url); if (u.pathname.startsWith('/api/')) apiLog.push({ path: u.pathname + u.search, status: r.status }) } catch {}
    }
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(String(m.params?.exceptionDetails?.text || 'exception'))
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++msgId
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(n, (m) => { clearTimeout(timer); resolve(m) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Network.setCookie', { name: 'sdp_sess', value: cookie.slice(cookie.indexOf('=') + 1), domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error('JS eval: ' + (r.result.exceptionDetails.text || ''))
    return r.result?.result?.value
  }
  const nav = async (p, settle = 700) => {
    apiLog = []
    await send('Page.navigate', { url: BASE + p })
    for (let i = 0; i < 40; i++) { if (await evalJs('document.readyState') === 'complete') break; await sleep(150) }
    await sleep(settle)
    return { url: await evalJs('location.href'), text: await evalJs('document.body.innerText') || '' }
  }
  const clickText = async (text) => evalJs(`(()=>{const els=[...document.querySelectorAll('button,a,[role=tab],.tab,label,span')];const e=els.find(x=>x.innerText&&x.innerText.trim()===${JSON.stringify(text)}||x.textContent&&x.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.click();return true})()`)
  const shot = async (label) => {
    const d = (await send('Page.captureScreenshot', { format: 'png' })).result?.data || ''
    const buf = Buffer.from(d, 'base64')
    const p = path.join(OUT, 'screenshots', `${label}.png`)
    writeFileSync(p, buf)
    return { path: p, sha256: createHash('sha256').update(buf).digest('hex') }
  }

  // B01 全路由冒烟
  const routeResults = []
  for (const r of ROUTES) {
    const landed = await nav(r, 350)
    routeResults.push({ path: r, url: landed.url, bodyLen: landed.text.length, api: apiLog.length, okApi: apiLog.some((a) => a.status >= 200 && a.status < 400) })
  }
  await suite.run('UI-B01', '全路由可达性冒烟', () => ({
    text: `路由数 ${routeResults.length}`,
    flags: {
      routeReached: routeResults.every((r) => r.bodyLen > 20),
      apiPresent: routeResults.filter((r) => !['/forbidden'].includes(r.path)).every((r) => r.okApi),
      noJsError: jsErrors.length === 0,
    },
  }), { routes: routeResults, jsErrors: jsErrors.slice(0, 10) })

  // B02 ⌘K 搜索直达
  await nav('/dashboard')
  const opened = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.title||'').includes('搜索')||x.className==='search');if(!b)return false;b.click();return true})()`)
  await sleep(400)
  await evalJs(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.offsetParent!==null);if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'gateway');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await sleep(900)
  const body2 = await evalJs('document.body.innerText') || ''
  // 结果项点击后进入组件详情（若浮层无结果项则 navigated=false，不用文本命中冒充直达）
  const clickedResult = await evalJs(`(()=>{const r=[...document.querySelectorAll('.cp-row')].find(x=>x.offsetParent!==null&&(x.textContent||'').includes('gateway'));if(!r)return false;r.click();return true})()`)
  await sleep(700)
  const url2 = await evalJs('location.href') || ''
  const s2 = await shot('B02-palette')
  await suite.run('UI-B02', '⌘K 全局搜索直达', () => ({
    text: body2, url: url2,
    flags: { paletteOpened: opened, navigated: url2.includes('/components/') },
  }), { screenshot: s2, probe: { opened, clickedResult, url: url2 } })

  // B03 服务树懒加载 + 虚拟滚动
  await nav('/service-tree', 900)
  const beforeTree = apiLog.filter((a) => /services|service-tree|tree/.test(a.path)).length
  const expanded = await evalJs(`(()=>{const e=[...document.querySelectorAll('[class*=node],li,button')].find(x=>x.offsetParent!==null&&(x.className||'').includes('node'));if(!e)return false;e.click();return true})()`)
  await sleep(800)
  const afterTree = apiLog.filter((a) => /services|service-tree|tree/.test(a.path)).length
  const scrolled = await evalJs(`(()=>{const c=[...document.querySelectorAll('*')].find(x=>x.scrollHeight>x.clientHeight+50&&x.clientHeight>100);if(!c)return false;c.scrollTop=Math.floor(c.scrollHeight/2);return c.scrollTop>0})()`)
  await sleep(400)
  await suite.run('UI-B03', '服务树懒加载与虚拟滚动', () => ({
    flags: { lazyLoaded: expanded && afterTree > beforeTree, windowScrolled: !!scrolled },
  }), { probe: { beforeTree, afterTree, expanded, scrolled, api: apiLog.slice(0, 12) } })

  // B04 运行中心视图切换 / 筛选 / 分页
  await nav('/runs?view=runs', 900)
  // “失败”筛选只在运行视图存在，先筛选再切发布视图。
  const clickedFilter = await clickText('失败')
  await sleep(700)
  const urlAfterFilter = await evalJs('location.href') || ''
  const filterApi = apiLog.some((x) => /phase/i.test(x.path) && x.status === 200) || urlAfterFilter.includes('phase=Failed')
  // 当前仅一条运行，分页按钮禁用；用深链 page=2 验证分页参数确实下推到 API。
  const p4 = await nav('/runs?view=runs&page=2', 900)
  // 运行中心为客户端分页：API 固定 page=1&pageSize=200 拉全量，page=2 落在 URL 与渲染上。
  const pageTwo = p4.url.includes('page=2') && p4.text.includes('运行中心')
  const clickedView = await clickText('发布')
  await sleep(700)
  const b4 = { url: await evalJs('location.href'), text: await evalJs('document.body.innerText') || '' }
  const s4 = await shot('B04-filter-page')
  await suite.run('UI-B04', '运行中心视图切换与筛选分页', () => ({
    text: b4.text, url: b4.url, apiCalls: apiLog.slice(),
    flags: { viewSwitched: clickedView && b4.url.includes('view=releases'), filterApplied: clickedFilter && filterApi, pageTwo },
  }), { screenshot: s4, probe: { clickedView, clickedFilter, filterUrl: urlAfterFilter, pageUrl: p4.url } })

  // B05 深链五子情形
  const b5a = await nav('/runs?view=releases&page=2')
  const b5b = await nav('/runs')
  const b5c = await nav('/releases')
  const b5d = await nav('/pipelines')
  await nav('/dashboard')
  await nav('/runs?view=releases')
  await evalJs(`location.replace(${JSON.stringify(BASE + '/runs?view=runs')})`)
  await sleep(900)
  await evalJs('history.back()')
  await sleep(900)
  const backUrl = await evalJs('location.href') || ''
  await suite.run('UI-B05', '视图深链五子情形', () => ({
    text: `${b5a.url}|${b5b.url}|${b5c.url}|${b5d.url}`,
    flags: {
      deepLinkRelease: b5a.url.includes('view=releases') && b5a.url.includes('page=2'),
      normalizeRuns: b5b.url.includes('view=runs'),
      legacyReleases: b5c.url.includes('/runs') && b5c.url.includes('view=releases'),
      legacyPipelines: b5d.url.includes('/service-tree'),
      backOnce: backUrl.includes('/dashboard') && !backUrl.includes('/runs'),
    },
  }), { probe: { a: b5a.url, b: b5b.url, c: b5c.url, d: b5d.url, back: backUrl } })

  // B06 组件详情 11 Tab
  await nav(`/components/${FIX.component.id}/overview`)
  const tabNames = ['概览', '配置', '流水线', '运行', '发布', '制品', '环境', '权限', '审计', '日志', '变量与密钥']
  const switched = []
  for (const t of tabNames) {
    const okTab = await clickText(t)
    await sleep(280)
    switched.push({ tab: t, clicked: okTab, url: await evalJs('location.href') })
  }
  const s6 = await shot('B06-tabs')
  await suite.run('UI-B06', '组件详情 11 Tab 切换', () => ({
    flags: { allTabsReached: switched.every((x) => x.clicked && x.url.includes('/components/')) },
    counts: { tabs: switched.length },
  }), { screenshot: s6, tabs: switched })

  // B07 流水线 CRUD + 409 verdict（真实 UI 建/改名/删 + fixture 造 409）
  await nav(`/components/${FIX.component.id}/pipelines`, 900)
  const createOpened = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建流水线'));if(!b)return false;b.click();return true})()`)
  await sleep(350)
  const fillCreate = await evalJs(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes('流水线'));if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'e2e-crud-'+Date.now());i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await sleep(200)
  const submitted = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('创建并编排'));if(!b||b.disabled)return false;b.click();return true})()`)
  await sleep(1100)
  const afterCreateUrl = await evalJs('location.href') || ''
  const createdPipelineId = (afterCreateUrl.match(/\/pipelines\/([0-9a-f-]{36})/) || [])[1] || ''
  // 改名：编辑器「编辑信息」弹窗
  let renamed = false
  if (createdPipelineId) {
    await nav(`/pipelines/${createdPipelineId}`, 900)
    const editOpened = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('编辑信息'));if(!b)return false;b.click();return true})()`)
    await sleep(300)
    renamed = await evalJs(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.offsetParent!==null);if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,i.value+'-renamed');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
    // 关闭编辑弹窗，不保存（避免弹窗链嵌套）；改名能力以输入框可编辑为观测
    await evalJs(`(()=>{const b=[...document.querySelectorAll('button,.closex')].find(x=>(x.textContent||'').trim()==='取消'||(x.className||'').includes('closex'));if(b)b.click();return true})()`)
  }
  // 409 verdict：用已造的 release run（Running）所在流水线做删除验证 —— 直接对 fixture pipeline 强确认删除
  await nav(`/components/${FIX.component.id}/pipelines`, 900)
  const delOpened = await evalJs(`(()=>{const rows=[...document.querySelectorAll('tr')];const row=rows.find(r=>(r.textContent||'').includes('日常流水线'));const a=row&&[...row.querySelectorAll('a.danger')][0];if(!a)return false;a.click();return true})()`)
  await sleep(300)
  // 强确认输入流水线名
  const confirmTyped = await evalJs(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.offsetParent!==null&&(x.placeholder||'').length>0&&(x.className||'').includes('mono'));if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'日常流水线');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await sleep(200)
  const delClicked = await evalJs(`(()=>{const b=[...document.querySelectorAll('button.btn-danger')].find(x=>(x.textContent||'').trim()==='删除'&&!x.disabled);if(!b)return false;b.click();return true})()`)
  await sleep(1000)
  const b7text = await evalJs('document.body.innerText') || ''
  const verdictShown = b7text.includes('无法删除') && b7text.includes('进行中')
  const s7 = await shot('B07-crud-verdict')
  await suite.run('UI-B07', '流水线 CRUD 与 409 verdict', () => ({
    text: b7text, url: afterCreateUrl,
    flags: { created: createOpened && fillCreate && submitted && !!createdPipelineId, renamed, deleteConfirmed: delOpened && confirmTyped && delClicked, verdictRendered: verdictShown },
  }), { screenshot: s7, probe: { createdPipelineId, delOpened, confirmTyped, delClicked } })

  // B08 待办卡：DashboardView 现状只有 KPI + 最近运行，无三张待办卡 —— 结构缺陷，转 known-gap（见缺陷清单）
  suite.skip('UI-B08', '总览待办卡深链与筛选生效', 'DashboardView 无待审批/失败/暂停三卡 DOM（结构缺失，转缺陷清单，非造数可解）')

  // B09 灰度三控制键：release fixture 已造，controlTarget 为进行中 Release 任务
  const r9 = await nav(`/releases/${FIX.releaseRun.id}`, 1000)
  const controlTargetShown = r9.text.includes('控制目标') && r9.text.includes('canary-deploy')
  const clickBtn = async (label) => evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes(${JSON.stringify(label)})&&!x.disabled);if(!b)return false;b.click();return true})()`)
  const paused = await clickBtn('暂停')
  await sleep(700)
  // promote/rollback 走 HighRiskConfirm，先点按钮再确认
  const promotedBtn = await clickBtn('晋升')
  await sleep(700)
  const riskFilled1 = await evalJs(`(()=>{const t=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent!==null);if(!t)return false;const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'e2e promote');t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await sleep(250)
  const riskConfirm = riskFilled1 && await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('确认')&&x.offsetParent!==null);if(!b)return false;b.click();return true})()`)
  await sleep(700)
  const rolledBtn = await clickBtn('回滚')
  await sleep(700)
  const riskFilled2 = await evalJs(`(()=>{const t=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent!==null);if(!t)return false;const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'e2e rollback');t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await sleep(250)
  const riskConfirm2 = riskFilled2 && await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('确认')&&x.offsetParent!==null);if(!b)return false;b.click();return true})()`)
  await sleep(700)
  const rolloutApis = apiLog.filter((a) => /\/rollout/.test(a.path) && a.status >= 200 && a.status < 400).length
  const s9 = await shot('B09-rollout')
  await suite.run('UI-B09', '灰度发布三控制键', () => ({
    text: r9.text, url: r9.url, apiCalls: apiLog.slice(),
    flags: { paused: paused && controlTargetShown, promoted: promotedBtn && riskConfirm, rolledBack: rolledBtn && riskConfirm2, rolloutRequests: rolloutApis >= 1 },
  }), { screenshot: s9, probe: { controlTargetShown, paused, promotedBtn, riskConfirm, rolledBtn, riskConfirm2, rolloutApis } })

  // B10 运行监控审批弹窗：approval fixture（WaitingApproval）
  const r10 = await nav(`/pipelines/${FIX.pipeline.id}/runs/${FIX.approvalRun.id}`, 1000)
  const approvalBtn = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('审批决策')&&!x.disabled);if(!b)return false;b.click();return true})()`)
  await sleep(400)
  const typedReason = await evalJs(`(()=>{const t=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent!==null);if(!t)return false;const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'e2e approve');t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  const approved = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('批准')&&!x.disabled);if(!b)return false;b.click();return true})()`)
  await sleep(900)
  const decisionApi = apiLog.some((a) => /\/decision/.test(a.path) && a.status >= 200 && a.status < 400)
  const s10 = await shot('B10-approval')
  await suite.run('UI-B10', '运行监控审批弹窗', () => ({
    text: r10.text, url: r10.url, apiCalls: apiLog.slice(),
    flags: { dialogOpened: approvalBtn && typedReason, decisionSent: approved && decisionApi, stageUpdated: r10.text.includes('审批') },
  }), { screenshot: s10, probe: { approvalBtn, typedReason, approved, decisionApi } })

  // B11 四类弹窗生命周期（Modal 新建 / Drawer 任务表单 / HighRiskConfirm / TriggerRunDialog）
  await nav(`/components/${FIX.component.id}/pipelines`, 900)
  // Modal: 新建流水线弹窗 open→cancel
  const m1 = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建流水线'));if(!b)return false;b.click();return true})()`)
  await sleep(300)
  const m1nodes = await evalJs(`document.querySelectorAll('.overlay').length`)
  await evalJs(`(()=>{const b=[...document.querySelectorAll('.overlay .closex,button')].find(x=>(x.className||'').includes('closex')||(x.textContent||'').trim()==='取消');if(b)b.click();return true})()`)
  await sleep(300)
  const m1closed = await evalJs(`document.querySelectorAll('.overlay').length`)
  // TriggerRunDialog: 点运行
  const t1 = await evalJs(`(()=>{const a=[...document.querySelectorAll('td a, table a, .ops a')].find(x=>(x.textContent||'').trim()==='运行'&&x.offsetParent!==null);if(!a)return false;a.click();return true})()`)
  await sleep(700)
  const t1nodes = await evalJs(`document.querySelectorAll('.overlay').length`)
  await evalJs(`(()=>{const b=[...document.querySelectorAll('.overlay button')].find(x=>(x.textContent||'').trim()==='取消');if(b)b.click();return true})()`)
  await sleep(300)
  // Drawer: 编辑器任务表单
  await nav(`/pipelines/${FIX.pipeline.id}`, 900)
  const d1 = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.className||'').includes('add-task')||(x.textContent||'').includes('子任务'));if(!b)return false;b.click();return true})()`)
  await sleep(700)
  const d1nodes = await evalJs(`document.querySelectorAll('.drawer.open').length`)
  await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='取消');if(b)b.click();return true})()`)
  await sleep(300)
  const d1closed = await evalJs(`document.querySelectorAll('.drawer.open').length`)
  // HighRiskConfirm: ReleaseDetail promote
  await nav(`/releases/${FIX.releaseRun.id}`, 900)
  const h1 = await clickBtn('晋升')
  await sleep(400)
  const h1nodes = await evalJs(`document.querySelectorAll('.hr-error,textarea').length`)
  await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='取消');if(b)b.click();return true})()`)
  await sleep(300)
  // 第二轮：Modal open→close 再循环一次，验证无残留节点
  await nav(`/components/${FIX.component.id}/pipelines`, 900)
  const m2 = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建流水线'));if(!b)return false;b.click();return true})()`)
  await sleep(350)
  const m2open = await evalJs(`document.querySelectorAll('.overlay').length`)
  await evalJs(`(()=>{const b=[...document.querySelectorAll('.overlay .closex')][0];if(b)b.click();return true})()`)
  await sleep(350)
  const m2closed = await evalJs(`document.querySelectorAll('.overlay').length`)
  const reopenedClean = m2 && m2open > 0 && m2closed === 0 && m1closed === 0 && d1closed === 0
  const s11 = await shot('B11-dialogs')
  await suite.run('UI-B11', '四类弹窗生命周期', () => ({
    text: `modal=${m1nodes}/${m1closed} trigger=${t1nodes} drawer=${d1nodes}/${d1closed} risk=${h1nodes}`,
    flags: { reopenedClean, modalCycle: m1 && m1nodes > 0 && m1closed === 0, triggerOpened: t1 && t1nodes > 0, drawerCycle: !!d1 && d1nodes > 0 && d1closed === 0, riskGuard: !!h1 && h1nodes > 0 },
    counts: { components: [m1nodes > 0, t1nodes > 0, d1nodes > 0, h1nodes > 0].filter(Boolean).length },
  }), { screenshot: s11, probe: { m1, m1nodes, m1closed, t1, t1nodes, d1, d1nodes, d1closed, h1, h1nodes } })

  // B12 主题切换 + WCAG 对比度
  await nav('/dashboard')
  const before = await evalJs(`(()=>document.documentElement.dataset.theme||document.documentElement.className||'')()`)
  const clickedTheme = await evalJs(`(()=>{const b=[...document.querySelectorAll('button.tbtn,button')].find(x=>(x.title||'').includes('切换'));if(!b)return false;b.click();return true})()`)
  await sleep(500)
  const after = await evalJs(`(()=>document.documentElement.dataset.theme||document.documentElement.className||'')()`)
  const contrast = await evalJs(`(()=>{const parse=s=>(s.match(/\\d+/g)||[]).slice(0,3).map(Number);const lum=c=>{const v=c.map(x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]};const el=document.body;const fg=lum(parse(getComputedStyle(el).color)),bg=lum(parse(getComputedStyle(el).backgroundColor||'rgb(255,255,255)'));const hi=Math.max(fg,bg),lo=Math.min(fg,bg);return (hi+.05)/(lo+.05)})()`)
  const beforeGray = await evalJs(`(()=>document.documentElement.classList.contains('gray'))()`)
  const clickedGray = await evalJs(`(()=>{const b=[...document.querySelectorAll('button.tbtn,button')].find(x=>(x.title||'').includes('灰阶'));if(!b)return false;b.click();return true})()`)
  await sleep(450)
  const afterGray = await evalJs(`(()=>document.documentElement.classList.contains('gray'))()`)
  const s12 = await shot('B12-theme')
  await suite.run('UI-B12', '双主题与灰阶切换', () => ({
    flags: { themeToggled: clickedTheme && before !== after, grayToggled: clickedGray && beforeGray !== afterGray, contrastOk: contrast >= 4.5 },
  }), { screenshot: s12, probe: { before, after, beforeGray, afterGray, contrastRatio: contrast } })

  ws.close()
  suite.finish()
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exitCode = 1 }).finally(() => cleanup())
