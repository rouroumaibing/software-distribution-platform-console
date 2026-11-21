#!/usr/bin/env node
// console 端到端验证：脚本内启动浏览器（本地模式连 Vite / 集群模式连已部署网关），
// 经 CDP 驱动真实页面跑用户流，落外部证据。零外部依赖（node 内置模块 + node22 全局 WebSocket）。
//
// 两种模式：
//   E2E_MODE=local（默认）——自启 Vite + Chrome CDP，认证旁路，跑 FLOW 五页（历史行为，原样保留）。
//   E2E_MODE=cluster       ——连已部署集群网关（E2E_BASE_URL，默认 https://www.sdpworkflow.com:8443），
//                              先 POST /api/v1/auth/login 建会话并注入 sdp_sess cookie，
//                              再逐用例驱动，采集 /api/* 调用与响应字段到 manifest.apiCalls。
// 用例清单：E2E_CASES="path|label|expect,..."（集群模式）；未设则用 CLUSTER_FLOW 默认核心页。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, openSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EVIDENCE = path.join(REPO, 'evidence')
const MODE = process.env.E2E_MODE || 'local'
// 集群模式连自签证书网关：node fetch 不信任自签 CA；仅此模式放宽 TLS 校验。
if (MODE === 'cluster') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const VITE_PORT = Number(process.env.E2E_VITE_PORT || 5173)
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9222)
const BASE = MODE === 'cluster'
  ? (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
  : `http://127.0.0.1:${VITE_PORT}`
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(EVIDENCE, STAMP)
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const E2E_USER = process.env.E2E_USER || 'admin'
const E2E_PASS = process.env.E2E_PASS || 'Sdp@12345x'

// 本地模式历史 FLOW（认证旁路五页）。
const LOCAL_FLOW = [
  { path: '/dashboard', label: '01-dashboard', expect: '总览' },
  { path: '/service-tree', label: '02-service-tree', expect: '服务树' },
  { path: '/runs', label: '03-run-center', expect: '运行' },
  { path: '/admin/targets', label: '04-admin-targets', expect: '接入' },
  { path: '/forbidden', label: '05-forbidden', expect: '权限' },
]
// 集群模式默认核心页（带登录态）。可由 E2E_CASES 覆盖。
const CLUSTER_FLOW = [
  { path: '/dashboard', label: 'B01-dashboard', expect: '总览' },
  { path: '/service-tree', label: 'B01-service-tree', expect: '服务树' },
  { path: '/runs', label: 'B01-run-center', expect: '运行' },
  { path: '/admin/targets', label: 'B01-admin-targets', expect: '接入' },
  { path: '/notifications/settings', label: 'B01-notifications', expect: '' },
  { path: '/me/tokens', label: 'B01-tokens', expect: '' },
  { path: '/admin/permissions', label: 'B01-admin-permissions', expect: '' },
  { path: '/org/dashboard?org=default', label: 'B01-org-dashboard', expect: '' },
  { path: '/forbidden', label: 'B01-forbidden', expect: '权限' },
]

function parseCases(raw) {
  if (!raw) return null
  const out = []
  for (const part of raw.split(',')) {
    const [p, l, e = ''] = part.split('|')
    if (!p || !l) continue
    out.push({ path: p, label: l, expect: e })
  }
  return out.length ? out : null
}

const FLOW = MODE === 'cluster'
  ? (parseCases(process.env.E2E_CASES) || CLUSTER_FLOW)
  : LOCAL_FLOW

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const children = []

function cleanup() {
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM') } catch { /* 已退出 */ }
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

async function waitFor(url, tries = 40, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (r.ok) return true
    } catch { /* 未就绪 */ }
    await sleep(gap)
  }
  return false
}

function spawnDetached(cmd, args, logPath) {
  mkdirSync(path.dirname(logPath), { recursive: true })
  const out = openSync(logPath, 'a')
  const c = spawn(cmd, args, { cwd: REPO, detached: true, stdio: ['ignore', out, out] })
  children.push(c)
  return c
}

// 集群模式：登录建会话，返回 cookie 与登录证据。凭据只用于请求体，不落盘。
async function clusterLogin() {
  const url = `${BASE}/api/v1/auth/login`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: E2E_USER, password: E2E_PASS }),
    signal: AbortSignal.timeout(15000),
  })
  const setCookie = resp.headers.get('set-cookie') || ''
  const cookie = setCookie.split(';')[0].trim()
  const body = await resp.text()
  const ok = resp.status === 200 && /sdp_sess=/.test(cookie)
  return { ok, status: resp.status, cookie, cookieName: cookie.split('=')[0], body: body.slice(0, 300), url }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true })
  mkdirSync(path.join(OUT, 'responses'), { recursive: true })
  const log = []
  const say = (s) => { log.push(`[${new Date().toISOString()}] ${s}`); console.log(s) }

  if (!existsSync(CHROME)) throw new Error(`Chrome 不存在: ${CHROME}`)

  let loginInfo = null
  if (MODE === 'cluster') {
    say(`集群模式：登录 ${BASE}`)
    loginInfo = await clusterLogin()
    say(`  登录 ${loginInfo.ok ? 'OK' : 'FAIL'} status=${loginInfo.status} cookie=${loginInfo.cookieName} body=${loginInfo.body}`)
    if (!loginInfo.ok) {
      writeFileSync(path.join(OUT, 'login-failure.json'), JSON.stringify({ ...loginInfo, cookie: '<redacted>' }, null, 2))
      throw new Error('集群登录失败：确认 admin 已完成首登改密、E2E_USER/E2E_PASS 正确')
    }
  } else {
    say(`启动 Vite :${VITE_PORT}`)
    spawnDetached('pnpm', ['dev', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'],
      path.join(OUT, 'vite.log'))
    if (!await waitFor(BASE)) throw new Error('Vite 未就绪')
  }

  say(`启动 Chrome CDP :${CDP_PORT}`)
  const chromeArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/sdp-e2e-${STAMP}`, 'about:blank',
  ]
  if (MODE === 'cluster') chromeArgs.push('--ignore-certificate-errors') // 自签证书，仅本地验证环境
  spawnDetached(CHROME, chromeArgs, path.join(OUT, 'chrome.log'))
  if (!await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`)) throw new Error('CDP 未就绪')

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('无 page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })

  let msgId = 0
  const pending = new Map()
  const netLog = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response
      if (MODE === 'cluster') {
        try {
          const u = new URL(r.url)
          if (u.pathname.startsWith('/api/')) {
            netLog.push({ path: u.pathname + u.search, status: r.status, mime: r.mimeType || '' })
          }
        } catch { /* 非标准 URL 忽略 */ }
      } else if (r.url.startsWith(BASE)) {
        netLog.push({ url: r.url, status: r.status })
      }
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++msgId
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(n, (m) => { clearTimeout(timer); resolve(m) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')

  // 集群模式：导航前注入会话 cookie（浏览器已忽略证书错误）。
  if (MODE === 'cluster') {
    const host = new URL(BASE).hostname
    const cookieValue = loginInfo.cookie.slice(loginInfo.cookie.indexOf('=') + 1)
    const r = await send('Network.setCookie', {
      name: 'sdp_sess', value: cookieValue, domain: host, path: '/',
      secure: true, httpOnly: true, sameSite: 'Lax',
    })
    say(`  注入 sdp_sess cookie domain=${host} success=${r.result?.success}`)
  }

  const manifest = []
  let failures = 0
  for (const step of FLOW) {
    say(`驱动 ${step.path}`)
    netLog.length = 0
    await send('Page.navigate', { url: BASE + step.path })
    let ready = false
    for (let i = 0; i < 40; i++) {
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
      if (r.result?.result?.value === 'complete') { ready = true; break }
      await sleep(200)
    }
    await sleep(800) // Vue 挂载与异步渲染（集群模式 API 往返更慢）
    const title = (await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result?.result?.value || ''
    const urlNow = (await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result?.result?.value || ''
    const text = (await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })).result?.result?.value || ''
    const hasExpect = step.expect ? text.includes(step.expect) : true
    const shot = (await send('Page.captureScreenshot', { format: 'png' })).result?.data || ''
    const png = Buffer.from(shot, 'base64')

    const pngPath = path.join(OUT, 'screenshots', `${step.label}.png`)
    const jsonPath = path.join(OUT, 'responses', `${step.label}.json`)
    writeFileSync(pngPath, png)
    const responseObj = {
      mode: MODE, path: step.path, landedUrl: urlNow, title, expect: step.expect, hasExpect,
      bodyLen: text.length, bodySample: text.slice(0, 500),
      apiCalls: netLog.slice(), capturedAt: new Date().toISOString(),
    }
    writeFileSync(jsonPath, JSON.stringify(responseObj, null, 2))

    // 集群模式判据：导航落地 + 截图非空 + 期望文本（若有）+ 至少一个成功的 /api/* 调用。
    const apiOk = MODE !== 'cluster' || netLog.some((n) => n.status >= 200 && n.status < 400)
    const ok = ready && png.length > 1000 && text.length > 20 && hasExpect && apiOk
    if (!ok) failures++
    say(`  ${ok ? 'PASS' : 'FAIL'} title="${title}" bodyLen=${text.length} expect=${hasExpect} png=${png.length} api=${netLog.length} apiOk=${apiOk} landed=${urlNow}`)
    manifest.push({
      step: step.path, label: step.label, ok,
      png: pngPath, pngSha256: sha256(png),
      response: jsonPath, responseSha256: sha256(Buffer.from(JSON.stringify(responseObj))),
      apiCalls: netLog.slice(),
    })
  }

  ws.close()
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    stamp: STAMP, mode: MODE, base: BASE,
    auth: MODE === 'cluster'
      ? { mode: 'cookie', loginOk: loginInfo.ok, user: E2E_USER, cookieName: loginInfo.cookieName }
      : { mode: 'bypass' },
    steps: FLOW.length, failures, files: manifest,
    chain: MODE === 'cluster'
      ? 'login(cookie) -> chrome-cdp -> navigate -> dom+screenshot+api-capture -> evidence'
      : 'vite -> chrome-cdp -> navigate -> dom+screenshot+network -> evidence',
  }, null, 2))
  writeFileSync(path.join(OUT, 'e2e.log'), log.join('\n') + '\n')

  say(`E2E ${failures === 0 ? 'PASS' : 'FAIL'} mode=${MODE} failures=${failures} evidence=${OUT}`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('E2E ERROR:', e.message)
  process.exitCode = 1
}).finally(() => cleanup())
