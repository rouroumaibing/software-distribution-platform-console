#!/usr/bin/env node
// console 认证/权限守卫 E2E（UI-P 用例）：CDP 驱动，分别在无会话 / 无权限用户 /
// 平台管理员视角下访问受保护路由。判定全部由 contract-runner 依据契约完成。
// 用法：node scripts/e2e-guards.mjs
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSuite } from './contract-runner.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9226)
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const USER = process.env.E2E_USER || 'admin'
const PASS = process.env.E2E_PASS || 'Sdp@12345x'
const VIEW_USER = process.env.E2E_VIEWER_USER || 'e2e-viewer'
const VIEW_PASS = process.env.E2E_VIEWER_PASS || 'Viewer@12345x'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(REPO, 'evidence', STAMP)
const CASE_IDS = ['UI-P01', 'UI-P02', 'UI-P03', 'UI-P04', 'UI-P05']
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
async function loginAs(username, password) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(15000),
  })
  const raw = (r.headers.get('set-cookie') || '').split(';')[0]
  const body = await r.text()
  return { ok: r.status === 200 && raw.startsWith('sdp_sess='), status: r.status,
    value: raw.startsWith('sdp_sess=') ? raw.slice(raw.indexOf('=') + 1) : null,
    body: body.slice(0, 200) }
}

const suite = createSuite({
  suite: 'UI-P', caseIds: CASE_IDS, stamp: STAMP, out: OUT, base: BASE,
  auth: { modes: ['cookie', 'anonymous', 'cookie:viewer'] },
  chain: 'cdp -> cookie on/off + multi-role -> guarded route -> contract verdict -> evidence',
})

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true })
  suite.say('=== UI-P 认证与权限守卫（判定来自 criteria.mjs 契约）===')

  const admin = await loginAs(USER, PASS)
  const viewer = await loginAs(VIEW_USER, VIEW_PASS)
  if (!admin.ok || !viewer.ok) throw new Error(`登录失败 admin=${admin.status} viewer=${viewer.status}`)
  suite.say(`登录 OK admin=${admin.status} viewer=${viewer.status}`)

  spawnDetached(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--ignore-certificate-errors',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/sdp-guards-${STAMP}`, 'about:blank',
  ], path.join(OUT, 'chrome.log'))
  if (!await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`)) throw new Error('CDP 未就绪')
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const target = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let id = 0; const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(n, (m) => { clearTimeout(timer); resolve(m) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  const host = new URL(BASE).hostname
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
  const nav = async (p) => {
    await send('Page.navigate', { url: BASE + p })
    for (let i = 0; i < 40; i++) { if (await evalJs('document.readyState') === 'complete') break; await sleep(150) }
    await sleep(700)
    return { url: (await evalJs('location.href')) || '', text: (await evalJs('document.body.innerText')) || '' }
  }
  const setCookie = async (v) => send('Network.setCookie', { name: 'sdp_sess', value: v, domain: host, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })
  const delCookie = async () => send('Network.deleteCookies', { name: 'sdp_sess', domain: host, path: '/' })
  const shot = async (label) => {
    const d = (await send('Page.captureScreenshot', { format: 'png' })).result?.data || ''
    const buf = Buffer.from(d, 'base64')
    const p = path.join(OUT, 'screenshots', `${label}.png`)
    writeFileSync(p, buf)
    return { path: p, sha256: createHash('sha256').update(buf).digest('hex') }
  }

  // P01：无权限用户访问 L1 管理台
  await setCookie(viewer.value)
  const p01 = await nav('/admin/permissions')
  const s01 = await shot('P01-viewer-admin-forbidden')
  await suite.run('UI-P01', '非 platform-admin 访问 /admin/* 跳 forbidden', () => ({
    url: p01.url, text: p01.text,
    flags: { adminContentHidden: !p01.text.includes('角色管理') && !p01.text.includes('平台权限配置') },
  }), { screenshot: s01, probe: { landedUrl: p01.url } })

  // P02：平台管理员但非 org_admin 访问 L2 组织台；管理员侧 fixture 受环境阻塞（契约标 knownGap）
  await setCookie(admin.value)
  const p02 = await nav('/org/dashboard?org=default')
  const s02 = await shot('P02-l2-forbidden')
  await suite.run('UI-P02', 'L2 组织台守卫', () => ({
    url: p02.url, text: p02.text,
    flags: { forbiddenForNonAdmin: p02.url.includes('/forbidden'), enteredForOrgAdmin: false },
  }), { screenshot: s02, probe: { blocker: '本地 KC 写 org_admin 属性后 password grant 返回 UPDATE_PASSWORD，组织管理员 fixture 不可用' } })

  // P03：清会话跳登录并带 redirect；再以 viewer 会话回跳原路径
  await delCookie()
  const p03a = await nav('/dashboard')
  const redirectUrl = p03a.url
  await setCookie(viewer.value)
  const p03b = await nav('/dashboard')
  const s03 = await shot('P03-redirect-back')
  await suite.run('UI-P03', '未认证跳转与回跳', () => ({
    url: redirectUrl, text: p03a.text,
    flags: { redirectBack: p03b.url.includes('/dashboard') && !p03b.url.includes('/user/login') },
  }), { screenshot: s03, probe: { loginUrl: redirectUrl, backUrl: p03b.url, backMethod: 'api-login + cookie re-inject + navigate' } })

  // P04：密码登录 / 首登改密 / SSO 回调失败路径（API 层真实请求，不落凭据）
  const newUser = `e2e-firstlogin-${Date.now()}`
  const create = await fetch(`${BASE}/api/v1/keycloak/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `sdp_sess=${admin.value}` },
    body: JSON.stringify({ username: newUser, email: `${newUser}@sdp.test`, initialPassword: 'First@123456' }),
    signal: AbortSignal.timeout(15000),
  })
  const createBody = await create.text()
  const initial = await loginAs(newUser, 'First@123456')
  const changed = await fetch(`${BASE}/api/v1/auth/password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: newUser, oldPassword: 'First@123456', newPassword: 'First@12345x' }),
    signal: AbortSignal.timeout(15000),
  })
  const after = await loginAs(newUser, 'First@12345x')
  const sso = await fetch(`${BASE}/api/v1/auth/session/code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'invalid-e2e', state: 'invalid-e2e' }),
    signal: AbortSignal.timeout(15000),
  })
  const ssoBody = await sso.text()
  await suite.run('UI-P04', '登录双模式与首登改密', () => ({
    flags: {
      passwordLogin: viewer.ok && after.ok,
      firstLoginChange: create.status === 201 && initial.status === 400 && initial.body.includes('UPDATE_PASSWORD') && changed.status === 200 && after.ok,
      ssoCallback: sso.status >= 400 && !/access_token|id_token|sdp_sess|First@/.test(ssoBody),
    },
  }), { probe: { create: create.status, initial: initial.status, changed: changed.status, after: after.status, sso: sso.status } })

  // P05：认证旁路分册——实跑 harness local 模式并核对 auth 标记
  let bypassOk = false
  let bypassStamp = null
  try {
    execFileSync(process.execPath, [path.join(REPO, 'scripts', 'e2e-verify.mjs')], {
      cwd: REPO, env: { ...process.env, E2E_MODE: 'local', NODE_NO_WARNINGS: '1' },
      stdio: 'ignore', timeout: 180000,
    })
    const dirs = (await import('node:fs')).readdirSync(path.join(REPO, 'evidence')).filter((d) => /^\d{4}-/.test(d)).sort()
    for (const d of dirs.reverse()) {
      const f = path.join(REPO, 'evidence', d, 'manifest.json')
      if (!existsSync(f)) continue
      const m = JSON.parse(readFileSync(f, 'utf8'))
      if (m.mode === 'local' && m.auth?.mode === 'bypass') { bypassOk = m.steps === 5 && m.failures === 0; bypassStamp = d; break }
    }
  } catch {}
  await suite.run('UI-P05', '认证旁路标记与分册', () => ({
    flags: { authBypassed: bypassOk, manifestSeparated: bypassOk && admin.ok },
  }), { probe: { harnessEvidence: bypassStamp, mode: 'local/bypass vs cluster/cookie' } })

  ws.close()
  suite.finish({ roles: { admin: { roles: ['platform-admin'], orgAdmins: null }, viewer: { roles: null, orgAdmins: null } } })
}

main().catch((e) => { console.error('GUARD ERROR:', e.message); process.exitCode = 1 }).finally(() => cleanup())
