#!/usr/bin/env node
// console 端到端验证：脚本内启动 Vite 与 Chrome，经 CDP 驱动真实页面跑关键用户流，落外部证据。
// 零外部依赖（node 内置模块 + node22 全局 WebSocket）；一次会话内完成 build→起服务→驱动→落证据→清理。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, openSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EVIDENCE = path.join(REPO, 'evidence')
const VITE_PORT = Number(process.env.E2E_VITE_PORT || 5173)
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9222)
const BASE = `http://127.0.0.1:${VITE_PORT}`
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(EVIDENCE, STAMP)
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// 关键用户流：按 feature map 逐页驱动，每页读 DOM + 截图 + 采集网络响应。
const FLOW = [
  { path: '/dashboard', label: '01-dashboard', expect: '总览' },
  { path: '/service-tree', label: '02-service-tree', expect: '服务树' },
  { path: '/runs', label: '03-run-center', expect: '运行' },
  { path: '/admin/targets', label: '04-admin-targets', expect: '接入' },
  { path: '/forbidden', label: '05-forbidden', expect: '权限' },
]

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

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true })
  mkdirSync(path.join(OUT, 'responses'), { recursive: true })
  const log = []
  const say = (s) => { log.push(`[${new Date().toISOString()}] ${s}`); console.log(s) }

  if (!existsSync(CHROME)) throw new Error(`Chrome 不存在: ${CHROME}`)

  say(`启动 Vite :${VITE_PORT}`)
  spawnDetached('pnpm', ['dev', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'],
    path.join(OUT, 'vite.log'))
  if (!await waitFor(BASE)) throw new Error('Vite 未就绪')

  say(`启动 Chrome CDP :${CDP_PORT}`)
  spawnDetached(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/sdp-e2e-${STAMP}`, 'about:blank',
  ], path.join(OUT, 'chrome.log'))
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
      if (r.url.startsWith(BASE)) netLog.push({ url: r.url, status: r.status })
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
    await sleep(500) // Vue 挂载与异步渲染
    const title = (await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result?.result?.value || ''
    const text = (await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })).result?.result?.value || ''
    const hasExpect = text.includes(step.expect)
    const shot = (await send('Page.captureScreenshot', { format: 'png' })).result?.data || ''
    const png = Buffer.from(shot, 'base64')

    const pngPath = path.join(OUT, 'screenshots', `${step.label}.png`)
    const jsonPath = path.join(OUT, 'responses', `${step.label}.json`)
    writeFileSync(pngPath, png)
    writeFileSync(jsonPath, JSON.stringify({
      path: step.path, title, expect: step.expect, hasExpect,
      bodyLen: text.length, network: netLog.slice(), capturedAt: new Date().toISOString(),
    }, null, 2))

    const ok = ready && png.length > 1000 && text.length > 20 && hasExpect
    if (!ok) failures++
    say(`  ${ok ? 'PASS' : 'FAIL'} title="${title}" bodyLen=${text.length} expect=${hasExpect} png=${png.length} net=${netLog.length}`)
    manifest.push({ step: step.path, label: step.label, ok, png: pngPath, pngSha256: sha256(png), response: jsonPath, responseSha256: sha256(Buffer.from(JSON.stringify({ path: step.path, title, expect: step.expect, hasExpect, bodyLen: text.length, network: netLog.slice(), capturedAt: new Date().toISOString() }))) })
  }

  ws.close()
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    stamp: STAMP, base: BASE, steps: FLOW.length, failures,
    files: manifest, chain: 'vite -> chrome-cdp -> navigate -> dom+screenshot+network -> evidence',
  }, null, 2))
  writeFileSync(path.join(OUT, 'e2e.log'), log.join('\n') + '\n')

  say(`E2E ${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures} evidence=${OUT}`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('E2E ERROR:', e.message)
  process.exitCode = 1
}).finally(() => cleanup())
