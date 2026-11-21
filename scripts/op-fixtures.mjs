// UI 下发逻辑验证的公共 setup 与轻量造数：登录取 cookie、建 harness、读 fixture。
// 由各域 e2e-ops-*.mjs 复用，避免每个脚本重复登录/CDP 初始化样板。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpHarness } from './op-harness.mjs'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BASE = (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
export const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9232)
export const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const USER = process.env.E2E_USER || 'admin'
export const PASS = process.env.E2E_PASS || 'Sdp@12345x'
export const KUBECONFIG = process.env.KUBECONFIG || path.resolve(REPO, '..', '.kubeconfig')
export const NS = 'sdp-workflow'
export const PG_POD = process.env.PG_POD || 'postgres-646f584b8f-lb76k'
export const OUT_ROOT = path.join(REPO, 'evidence')

export function loadFixture() {
  return JSON.parse(readFileSync(path.join(OUT_ROOT, 'e2e-fixtures.json'), 'utf8'))
}

export async function boot(suite) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = path.join(OUT_ROOT, stamp)
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }), signal: AbortSignal.timeout(15000),
  })
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0]
  if (lr.status !== 200 || !cookie.startsWith('sdp_sess=')) throw new Error(`登录失败 ${lr.status}`)
  const ui = await createOpHarness({ REPO, BASE, OUT: out, STAMP: stamp, CHROME, CDP_PORT, cookie, KUBECONFIG, PG_POD, NS })
  const sub = (await ui.api('GET', '/userinfo')).data.data.subject
  ui.say(`=== ${suite}（请求 + 后端状态 + UI 反映 / S|A|B 分层判据）===`)
  return { ui, sub, stamp, out, cookie }
}

// 域名脚本统一收口：补一套件的 manifest 元信息。
export function finish(ui, suite, meta = {}) {
  return ui.finish({ suite, ...meta })
}
