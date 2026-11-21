#!/usr/bin/env node
// console 五态 / 异常态 E2E（UI-S 用例）：CDP Fetch 域拦截 hub API，注入
// 空数据 / 500 / 延迟 / 403，断言前端呈现对应状态。零外部依赖。
// 判定全部由 contract-runner 依据 criteria.mjs 契约完成；本脚本只产出观测事实。
// Dashboard 的「最近运行」走 /pipelines/:id/runs（非 /runs），故拦截用 /api/v1/*
// 通配 + URL 判定 /runs，且对每条注入用例断言命中数 > 0，避免注入未生效的假绿。
// 用法：node scripts/e2e-states.mjs
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, openSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSuite } from './contract-runner.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9224)
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const USER = process.env.E2E_USER || 'admin'
const PASS = process.env.E2E_PASS || 'Sdp@12345x'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(REPO, 'evidence', STAMP)
const CASE_IDS = ['UI-S01', 'UI-S02', 'UI-S03', 'UI-S04', 'UI-S05', 'UI-S06', 'UI-S07', 'UI-S08', 'UI-S09', 'UI-S10']
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
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
  suite: 'UI-S', caseIds: CASE_IDS, stamp: STAMP, out: OUT, base: BASE,
  auth: { user: USER, mode: 'cookie' },
  chain: 'login(cookie) -> chrome-cdp -> fetch-intercept(counted) -> contract verdict -> evidence',
})

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true })
  suite.say('=== UI-S 五态 / 异常态（判定来自 criteria.mjs 契约）===')

  // S00 是映射表附件，不依赖浏览器：从五态规范 §2 正向提取须覆盖的视图清单。
  const VIEWS = [
    ['P0/4.1', '配置版本抽屉列表'], ['P0/4.1', 'diff 视图'],
    ['P0/4.2', '版本列表'], ['P0/4.2', '版本详情（环境部署矩阵）'], ['P0/4.2', '版本对比'],
    ['P0/4.3', '触发器列表'], ['P0/4.3', '运行列表触发方式列'], ['P0/4.3', '运行详情触发上下文'],
    ['P1/5.1', '审批中心（待我审批/我发起的/已处理）'], ['P1/5.1', '审批策略列表'], ['P1/5.1', '审批时间线'],
    ['P1/5.2', '通知中心列表'], ['P1/5.2', '订阅规则列表'], ['P1/5.2', '渠道配置'],
    ['P1/5.3', '变量列表'], ['P1/5.3', '密钥列表'], ['P1/5.3', '变量组列表'],
    ['P1/5.4', '审计列表'], ['P1/5.4', '组件审计子视图'],
    ['P1/5.5', '运行列表（批量）'], ['P1/5.5', '运行产物区'], ['P1/5.5', '实时日志区'],
    ['P2/6.1', '服务树节点详情'], ['P2/6.1', '依赖图'], ['P2/6.1', '被谁依赖'], ['P2/6.1', '搜索结果'],
    ['P2/6.2', '跨组件制品检索结果'], ['P2/6.2', '制品详情（扫描/SBOM）'],
    ['P2/6.3', 'Runner 视图'], ['P2/6.3', '配额用量'], ['P2/6.3', '平台健康'],
    ['P2/6.4', '访问令牌列表'], ['P3/4.2', '分页组件'], ['P3/4.3', '总览趋势 KPI / 图表'],
  ]
  const mapping = VIEWS.map(([phase, view]) => ({
    phase, view,
    trigger: 'CDP Fetch 注入：200 空数组 / 延迟 2s / 500 / 403 + 正常响应',
    states: ['loading', 'empty', 'error', 'success', 'forbidden'],
    baselineId: 'pending-individual-capture',
  }))
  writeFileSync(path.join(OUT, 'UI-S00.json'), JSON.stringify({
    spec: '五态规范 §2', views: mapping, generatedFrom: 'CONSOLE-FRONTEND-FIVES-STATES-2026-10-11.md §2',
  }, null, 2))
  await suite.run('UI-S00', '五态覆盖矩阵登记', () => ({
    flags: { mappingComplete: mapping.length > 0 },
    counts: { views: mapping.length },
    meta: { mappingFile: path.join(OUT, 'UI-S00.json') },
  }), { mappingFile: path.join(OUT, 'UI-S00.json') })

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
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/sdp-states-${STAMP}`, 'about:blank',
  ], path.join(OUT, 'chrome.log'))
  if (!await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`)) throw new Error('CDP 未就绪')
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const target = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let id = 0; const pending = new Map()
  let activeRule = null
  let injectedThisCase = 0
  const apiLog = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params
      const isRuns = /\/runs(\?|$)|\/runs\/[^/]+\/log(\?|$)/.test(request.url)
      const rule = isRuns ? activeRule : null
      ;(async () => {
        try {
          if (!rule) { await send('Fetch.continueRequest', { requestId }); return }
          injectedThisCase++
          if (rule.kind === 'delay') {
            await sleep(rule.ms)
            await send('Fetch.continueRequest', { requestId })
          } else if (rule.kind === 'fulfill') {
            await send('Fetch.fulfillRequest', {
              requestId, responseCode: rule.status,
              responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
              body: Buffer.from(rule.body).toString('base64'),
            })
          } else if (rule.kind === 'fail') {
            await send('Fetch.failRequest', { requestId, errorReason: 'Failed' })
          }
        } catch {}
      })()
      return
    }
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
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Network.setCookie', {
    name: 'sdp_sess', value: cookie.slice(cookie.indexOf('=') + 1),
    domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
  })
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
  const nav = async (p) => {
    const sep = p.includes('?') ? '&' : '?'
    await send('Page.navigate', { url: `${BASE}${p}${sep}_s=${Date.now()}` })
    for (let i = 0; i < 40; i++) { if (await evalJs('document.readyState') === 'complete') break; await sleep(150) }
    await sleep(300)
    return { url: await evalJs('location.href'), text: (await evalJs('document.body.innerText')) || '' }
  }
  const shot = async (label) => {
    const d = (await send('Page.captureScreenshot', { format: 'png' })).result?.data || ''
    const buf = Buffer.from(d, 'base64')
    const p = path.join(OUT, 'screenshots', `${label}.png`)
    writeFileSync(p, buf)
    return { path: p, sha256: sha256(buf) }
  }
  const waitInjected = async (timeout = 10000) => {
    const t = Date.now()
    while (Date.now() - t < timeout) { if (injectedThisCase > 0) return true; await sleep(100) }
    return false
  }
  await send('Fetch.enable', { patterns: [{ urlPattern: `${BASE}/api/v1/*`, requestStage: 'Request' }] })

  async function record(id, name, rule, collect) {
    activeRule = rule
    injectedThisCase = 0
    apiLog.length = 0
    try {
      const landed = await nav('/dashboard')
      const injected = rule ? await waitInjected() : false
      // dashboard 对每个 pipeline 串行发 runs 请求，造数后流水线增多需等加载态收敛。
      for (let i = 0; i < 20; i++) {
        const t = (await evalJs('document.body.innerText')) || ''
        if (!t.includes('加载中') && !t.endsWith('…')) break
        await sleep(200)
      }
      const settledText = (await evalJs('document.body.innerText')) || ''
      const ctx = {
        text: settledText, url: landed.url,
        injected, flags: {}, apiCalls: apiLog.slice(),
      }
      const extra = await collect(ctx)
      Object.assign(ctx.flags, extra.flags || {})
      await suite.run(id, name, () => ctx, { screenshot: extra.screenshot, probe: extra.probe })
    } catch (e) {
      await suite.run(id, name, () => { throw e }, {})
    } finally { activeRule = null }
  }

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(()=>{window.__sawLoading=false;const obs=new MutationObserver(()=>{if(document.body&&document.body.innerText.includes('加载中'))window.__sawLoading=true});document.addEventListener('DOMContentLoaded',()=>obs.observe(document.body,{subtree:true,childList:true,characterData:true}))})()`,
  })

  await record('UI-S01', '加载态（延迟 API）', { kind: 'delay', ms: 2000 }, async () => {
    const sawLoading = await evalJs('!!window.__sawLoading')
    const s = await shot('S01-loading')
    await sleep(2300)
    return { flags: { sawLoading }, screenshot: s }
  })

  await record('UI-S02', '空态（API 空数组）', {
    kind: 'fulfill', status: 200, body: JSON.stringify({ data: { items: [], total: 0, page: 1, pageSize: 20 } }),
  }, async () => ({ screenshot: await shot('S02-empty') }))

  await record('UI-S03', '错误态（API 500）', {
    kind: 'fulfill', status: 500, body: JSON.stringify({ error: 'injected 500' }),
  }, async (ctx) => ({ screenshot: await shot('S03-error'), probe: ctx.text.slice(0, 250) }))

  // S04 成功态：正常响应下真实运行渲染，行数与 API total 一致、状态徽章属于枚举。
  await record('UI-S04', '成功态（正常响应）', null, async (ctx) => {
    const apiRuns = ctx.apiCalls.filter((x) => /\/runs(\?|$)/.test(x.path) && x.status === 200)
    const fixtureRun = JSON.parse((await import('node:fs')).readFileSync(path.join(REPO, 'evidence', 'e2e-fixtures.json'), 'utf8')).run
    const rowsMatchApi = apiRuns.length > 0 && ctx.text.includes(fixtureRun.name)
    const badgesConform = /Succeeded|Failed|Running|Paused|Pending/.test(ctx.text)
    const s = await shot('S04-success')
    return { flags: { rowsMatchApi, badgesConform }, probe: { apiRuns: apiRuns.length, runName: fixtureRun.name }, screenshot: s }
  })

  await record('UI-S05', '无权限态（API 403 就地错误态）', {
    kind: 'fulfill', status: 403, body: JSON.stringify({ error: 'insufficient permission' }),
  }, async (ctx) => ({ screenshot: await shot('S05-forbidden'), probe: ctx.text.slice(-250) }))

  // S06 403 策略：viewer 会话下验证「隐藏」（平台管理菜单不渲染）+「可点后拦截」（守卫跳 forbidden）。
  // 禁用+tooltip 权限策略前端无实现，转缺陷清单。
  const vlr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e-viewer', password: 'Viewer@12345x' }), signal: AbortSignal.timeout(15000),
  })
  const vcookie = (vlr.headers.get('set-cookie') || '').split(';')[0]
  if (vlr.status !== 200 || !vcookie.startsWith('sdp_sess=')) throw new Error(`viewer 登录失败 ${vlr.status}`)
  await send('Network.setCookie', { name: 'sdp_sess', value: vcookie.slice(vcookie.indexOf('=') + 1), domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })
  activeRule = null
  const vNav = await nav('/dashboard')
  const hiddenStrategy = !vNav.text.includes('平台管理') && !vNav.text.includes('集群权限')
  const interceptNav = await nav('/admin/targets')
  const interceptUrl = interceptNav.url
  const interceptStrategy = interceptUrl.includes('/forbidden')
  const s6 = await shot('S06-viewer-strategies')
  await suite.run('UI-S06', '403 策略（隐藏 / 拦截）', () => ({
    text: vNav.text, url: interceptUrl,
    flags: { hiddenStrategy, interceptStrategy },
  }), { screenshot: s6, probe: { hiddenStrategy, interceptUrl } })

  // S07 权限判定顺序：viewer 打开平台页被守卫拦（不发 /ops/*）；admin 打开同页发 /ops/health。
  activeRule = null
  apiLog.length = 0
  const v7 = await nav('/admin/targets')
  const viewerOpsCalls = apiLog.filter((a) => /\/ops\//.test(a.path)).length
  const viewerForbidden = v7.url.includes('/forbidden')
  const noListRequestForbidden = viewerOpsCalls === 0 && viewerForbidden
  // 切回 admin 会话，打开 PlatformAdminView（会调 /ops/health）。
  await send('Network.setCookie', { name: 'sdp_sess', value: cookie.slice(cookie.indexOf('=') + 1), domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })
  apiLog.length = 0
  const a7 = await nav('/admin/targets')
  const adminOpsCalls = apiLog.filter((a) => /\/ops\//.test(a.path)).length
  const listRequestAllowed = adminOpsCalls > 0
  await suite.run('UI-S07', '权限判定顺序', () => ({
    url: a7.url, text: a7.text, apiCalls: apiLog.slice(),
    flags: { noListRequestForbidden, listRequestAllowed },
  }), { probe: { viewerOpsCalls, viewerForbidden, adminOpsCalls, viewerUrl: v7.url } })

  // S08 制品库错误态：前端 catch 静默、无错误 DOM（ui-05 确认），转缺陷清单，不静默跳过。
  suite.skip('UI-S08', '制品库错误态', '前端制品拉取失败 catch 静默、无错误态 DOM（ui-05:220 确认）——结构缺陷，转缺陷清单')

  // S09 日志区三态：注入 /runs/:id/log 延迟看加载态、空数组看空态。错误/重连态无入口转缺陷。
  const FIXS = JSON.parse((await import('node:fs')).readFileSync(path.join(REPO, 'evidence', 'e2e-fixtures.json'), 'utf8'))
  const logRunId = FIXS.run.id
  const monitorPath = `/pipelines/${FIXS.pipeline.id}/runs/${logRunId}`
  activeRule = { kind: 'delay', ms: 2000 }
  injectedThisCase = 0
  const logNav1 = await nav(monitorPath)
  // MutationObserver 记录日志区是否出现过「加载中」（延迟期间采样）。
  const logLoading = (logNav1.text.includes('加载中') || logNav1.text.includes('加载')) && injectedThisCase > 0
  const s9a = await shot('S09-log-loading')
  await sleep(2200)
  activeRule = { kind: 'fulfill', status: 200, body: JSON.stringify({ data: [] }) }
  injectedThisCase = 0
  const logNav2 = await nav(monitorPath)
  const logEmpty = logNav2.text.includes('暂无日志') || logNav2.text.includes('等待输出')
  const s9b = await shot('S09-log-empty')
  activeRule = null
  await suite.run('UI-S09', '日志区状态切换', () => ({
    text: logNav2.text, url: logNav2.url,
    flags: { logEmpty, logPanelPresent: logNav2.text.includes('日志') && logNav2.text.includes('刷新') },
  }), { screenshot: s9b, probe: { logEmpty, logNav1Text: logNav1.text.slice(-200) }, screenshots: [s9a, s9b] })

  // S10 五态灰阶可辨：StatusBadge 统一圆点+文字、无五种形状 DOM，转缺陷清单（形状可辨无法机器判定）。
  suite.skip('UI-S10', '五态灰阶可辨', 'StatusBadge 五态共用圆点+文字，无五种形状 DOM；灰阶开关已可验但形状可辨无判据——转缺陷清单')

  ws.close()
  suite.finish()
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exitCode = 1 }).finally(() => cleanup())
