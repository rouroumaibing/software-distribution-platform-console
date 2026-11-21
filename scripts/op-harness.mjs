// UI 下发逻辑验证 harness：判据 = 请求正确 + 后端状态真实改变 + UI 反映。
// 与呈现层 E2E 的本质区别：以"后端状态按请求改变"为第一证据，杜绝"toast 出现但没落库"的假绿。
// 用法：由 e2e-operations.mjs 引入，不单独运行。
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, openSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function createOpHarness({ REPO, BASE, OUT, STAMP, CHROME, CDP_PORT, cookie, KUBECONFIG, PG_POD, NS }) {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(path.join(OUT, 'screenshots'), { recursive: true })
  const children = []
  const cleanup = () => { for (const c of children) { try { process.kill(-c.pid, 'SIGTERM') } catch {} } }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(130) })

  const logFile = openSync(path.join(OUT, 'chrome.log'), 'a')
  const c = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--ignore-certificate-errors',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/sdp-op-${STAMP}`, 'about:blank',
  ], { cwd: REPO, detached: true, stdio: ['ignore', logFile, logFile] })
  children.push(c)
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break } catch {}
    await sleep(250)
  }
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const target = targets.find((t) => t.type === 'page')
  if (!target) throw new Error('CDP 无 page target')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let id = 0
  const pending = new Map()
  const apiLog = []
  const jsErrors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request
      try {
        const u = new URL(r.url)
        if (u.pathname.startsWith('/api/')) {
          apiLog.push({ method: r.method, path: u.pathname + u.search, body: r.postData || undefined, status: null })
        }
      } catch {}
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response
      try {
        const u = new URL(r.url)
        if (u.pathname.startsWith('/api/')) {
          const hit = [...apiLog].reverse().find((a) => a.path === u.pathname + u.search && a.status === null)
          if (hit) hit.status = r.status
          else apiLog.push({ method: '', path: u.pathname + u.search, status: r.status })
        }
      } catch {}
    }
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(String(m.params?.exceptionDetails?.text || 'exception'))
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(n, (m) => { clearTimeout(timer); resolve(m) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  // 原生 prompt/confirm 处理：defaultPrompt 供模式化应答，避免 CDP 点击后弹窗挂起。
  let dialogHandler = null
  ws.onmessage = ((prev) => (e) => {
    prev(e)
    const m = JSON.parse(e.data)
    if (m.method === 'Page.javascriptDialogOpening' && dialogHandler) {
      const ans = dialogHandler(m.params)
      void send('Page.handleJavaScriptDialog', { accept: ans.accept !== false, promptText: ans.text || '' })
    }
  })(ws.onmessage)
  const withDialog = async (handler, action) => {
    dialogHandler = handler
    try { return await action() } finally { dialogHandler = null }
  }
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Network.setCookie', {
    name: 'sdp_sess', value: cookie.slice(cookie.indexOf('=') + 1),
    domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
  })
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails
      const desc = d.exception?.description || d.text || ''
      throw new Error('JS eval: ' + desc.split('\n').slice(0, 2).join(' '))
    }
    return r.result?.result?.value
  }
  const nav = async (p, settle = 700) => {
    // CDP Network 域在多轮导航后会停止派发 requestWillBeSent；每次导航前重激活。
    await send('Network.enable')
    apiLog.length = 0
    await send('Page.navigate', { url: BASE + p })
    for (let i = 0; i < 40; i++) { if (await evalJs('document.readyState') === 'complete') break; await sleep(150) }
    await sleep(settle)
    return { url: await evalJs('location.href'), text: (await evalJs('document.body.innerText')) || '' }
  }
  const clickText = async (text, scope = 'button,a,[role=tab],.tab,label,span') => evalJs(
    `(()=>{const els=[...document.querySelectorAll(${JSON.stringify(scope)})];const e=els.find(x=>x.offsetParent!==null&&((x.innerText||'').trim()===${JSON.stringify(text)}||(x.textContent||'').trim()===${JSON.stringify(text)}));if(!e)return false;e.click();return true})()`,
  )
  const clickSel = async (sel) => evalJs(
    `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.offsetParent!==null);if(!e)return false;e.click();return true})()`,
  )
  const fill = async (sel, value) => evalJs(
    `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.offsetParent!==null);if(!e)return false;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const s=Object.getOwnPropertyDescriptor(proto,'value').set;s.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  )
  const shot = async (label) => {
    const d = (await send('Page.captureScreenshot', { format: 'png' })).result?.data || ''
    const buf = Buffer.from(d, 'base64')
    const p = path.join(OUT, 'screenshots', `${label}.png`)
    writeFileSync(p, buf)
    return { path: p, sha256: createHash('sha256').update(buf).digest('hex') }
  }
  const waitText = async (text, tries = 30, gap = 200) => {
    for (let i = 0; i < tries; i++) {
      const t = (await evalJs('document.body.innerText')) || ''
      if (t.includes(text)) return true
      await sleep(gap)
    }
    return false
  }

  // 独立后端核对：hub API（GET，带 admin cookie）—— 与 UI 操作不同的调用路径。
  const api = async (method, p, body) => {
    const r = await fetch(BASE + '/api/v1' + p, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    })
    const t = await r.text()
    let d; try { d = JSON.parse(t) } catch { d = t }
    return { status: r.status, data: d }
  }
  // PG 只读核对（软删/版本号/审计行等 API 不便观察的字段）。
  const pg = (sql) => {
    try {
      const out = execFileSync('kubectl', [
        '-n', NS, 'exec', PG_POD, '--', 'psql', '-U', 'sdp', '-d', 'sdp', '-t', '-A', '-c', sql,
      ], { env: { ...process.env, KUBECONFIG }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return out.trim().split('\n').filter(Boolean)
    } catch (e) {
      // 单条核对 SQL 失败（列名/表变更）不能中断整批用例——降级为空行让该用例诚实 FAIL。
      say(`  PG-WARN ${String(e.stderr || e.message).split('\n').slice(0, 2).join(' ')}`)
      return []
    }
  }

  const results = []
  const log = []
  const say = (s) => { const line = `[${new Date().toISOString()}] ${s}`; log.push(line); console.log(s) }

  // 统一用例执行：fn 必须返回 { requestOk, backendChanged, uiReflected, before, after, request, ... }
  // 三段全 true 才 PASS；任何一段 false 即 FAIL（诚实暴露，不洗绿）。
  async function run(id, name, fn, opts = {}) {
    const t0 = Date.now()
    const kind = opts.kind || 'S' // S 同步落库 / A 半异步 / B 纯 broker-only
    // apiLog 的重置只由 nav() 负责。run() 若在此清空，会抹掉操作阶段刚捕获的
    // 请求，让 probe 里的 apiSnapshot 恒为空数组——观测假象会让根因定位失真。
    const beforeJsErrors = jsErrors.length
    try {
      const o = await fn({ nav, clickText, clickSel, fill, evalJs, shot, waitText, api, pg, apiLog, sleep }) || {}
      const requestOk = !!o.requestOk
      const backendChanged = !!o.backendChanged
      const uiReflected = o.uiReflected === undefined ? true : !!o.uiReflected
      const newJsErrors = jsErrors.slice(beforeJsErrors)
      // B 类 hub 零写库（只转发给 broker），禁止用 UI 呈现或 DB 变化证明下发成功：
      // 判据收窄为"请求发出 + 2xx + 无 JS 异常"，真实状态推进列为 asyncObserve。
      const ok = kind === 'B'
        ? (requestOk && newJsErrors.length === 0)
        : (requestOk && backendChanged && uiReflected)
      const entry = {
        id, name, kind, ok, ms: Date.now() - t0,
        segments: { requestOk, backendChanged, uiReflected },
        before: o.before, after: o.after,
        request: o.request || apiLog.slice(-8),
        probe: o.probe,
        jsErrors: newJsErrors,
        asyncObserve: o.asyncObserve,
        screenshot: o.screenshot,
        note: o.note,
      }
      results.push(entry)
      say(`  ${ok ? 'PASS' : 'FAIL'} ${id} [${kind}] ${name} (${Date.now() - t0}ms req=${+requestOk} db=${+backendChanged} ui=${+uiReflected} jsErr=${newJsErrors.length})`)
      return entry
    } catch (e) {
      const entry = { id, name, ok: false, ms: Date.now() - t0, error: e.message }
      results.push(entry)
      say(`  FAIL ${id} ${name} ERROR=${e.message}`)
      return entry
    }
  }

  function finish(meta = {}) {
    const passed = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok).length
    const manifest = {
      stamp: STAMP, suite: 'UI-OP', base: BASE, auth: { cookie: 'redacted', mode: 'cookie' },
      criteria: 'UI 操作→请求→后端状态→UI 反映（op-harness.mjs）',
      total: results.length, passed, failed, results, ...meta,
    }
    writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
    writeFileSync(path.join(OUT, 'operations.log'), log.join('\n') + '\n')
    say(`UI-OP 完成：${passed}/${results.length} PASS, failed=${failed} evidence=${OUT}`)
    if (failed) process.exitCode = 1
    ws.close()
    cleanup()
    return manifest
  }

  return { run, finish, say, nav, clickText, clickSel, fill, evalJs, shot, waitText, api, pg, apiLog, sleep, withDialog, cleanup }
}
