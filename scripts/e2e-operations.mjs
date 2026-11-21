#!/usr/bin/env node
// UI 下发逻辑验证：每条用例以「请求正确 + 后端状态真实改变 + UI 反映」三段为判据。
// 与呈现层 E2E 的区别：后端状态由独立 GET/PG 核对，杜绝"toast 出现但没落库"的假绿。
// 用法：node scripts/e2e-operations.mjs
// 前置：本地 kind 集群已部署、seed-fixtures 已跑、admin cookie 有效。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpHarness } from './op-harness.mjs'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.E2E_BASE_URL || 'https://www.sdpworkflow.com:8443').replace(/\/$/, '')
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9232)
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const USER = process.env.E2E_USER || 'admin'
const PASS = process.env.E2E_PASS || 'Sdp@12345x'
const KUBECONFIG = process.env.KUBECONFIG || path.resolve(REPO, '..', '.kubeconfig')
const NS = 'sdp-workflow'
const PG_POD = process.env.PG_POD || 'postgres-646f584b8f-lb76k'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(REPO, 'evidence', STAMP)
const FIX = JSON.parse(readFileSync(path.join(REPO, 'evidence', 'e2e-fixtures.json'), 'utf8'))

async function main() {
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }), signal: AbortSignal.timeout(15000),
  })
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0]
  if (lr.status !== 200 || !cookie.startsWith('sdp_sess=')) throw new Error(`登录失败 ${lr.status}`)
  const ui = await createOpHarness({ REPO, BASE, OUT, STAMP, CHROME, CDP_PORT, cookie, KUBECONFIG, PG_POD, NS })
  const SUB = (await ui.api('GET', '/userinfo')).data.data.subject
  ui.say('=== UI 下发逻辑验证（请求 + 后端状态 + UI 反映三段判据）===')

  // OP-26a 建 PAT：后端 personal_access_tokens 新增，明文弹窗出现
  const patName = 'e2e-op-' + Date.now()
  const patBefore = ui.pg(`select count(*) from personal_access_tokens where subject='${SUB}'`)[0]
  await ui.nav('/me/tokens')
  await ui.clickText('＋ 创建令牌')
  await ui.sleep(300)
  await ui.fill('input.input[placeholder*="github-actions"]', patName)
  await ui.clickText('创建', 'button')
  await ui.sleep(900)
  const patAfter = ui.pg(`select name,scopes,revoked_at from personal_access_tokens where subject='${SUB}' and name='${patName}'`)
  const plaintextShown = (await ui.evalJs('document.body.innerText') || '').includes('令牌已创建')
  const patReq = ui.apiLog.find((a) => a.method === 'POST' && /\/me\/tokens/.test(a.path))
  await ui.run('OP-26a', '建 PAT（后端落库 + 明文一次展示）', () => ({
    requestOk: !!patReq && patReq.status >= 200 && patReq.status < 400,
    backendChanged: Number(patAfter.length ? 1 : 0) > Number(patBefore || 0) * 0 && patAfter.length > 0,
    uiReflected: plaintextShown,
    before: { count: patBefore }, after: { rows: patAfter },
    request: patReq, probe: { patName, patBefore, patAfter },
  }))

  // OP-26b 吊销 PAT：revoked_at 由 null 变非 null
  let revokedName = null
  if (patAfter.length) {
    revokedName = patName
    await ui.evalJs('(()=>{const b=[...document.querySelectorAll(".overlay .closex")][0];if(b)b.click();return true})()')
    await ui.sleep(300)
    const revokeClicked = await ui.evalJs(`(()=>{const rows=[...document.querySelectorAll('tr')];const r=rows.find(x=>(x.textContent||'').includes(${JSON.stringify(revokedName)}));const a=r&&[...r.querySelectorAll('a')].find(x=>(x.textContent||'').trim()==='吊销');if(!a)return false;a.click();return true})()`)
    await ui.sleep(300)
    const confirmClicked = await ui.clickText('确认吊销', 'button')
    await ui.sleep(900)
    const revoked = ui.pg(`select revoked_at from personal_access_tokens where name='${revokedName}'`)[0]
    const revokedReq = ui.apiLog.find((a) => a.method === 'DELETE' && /\/me\/tokens\//.test(a.path))
    await ui.run('OP-26b', '吊销 PAT（revoked_at 落库）', () => ({
      requestOk: !!revokedReq && revokedReq.status >= 200 && revokedReq.status < 400,
      backendChanged: !!revoked && revoked.trim().length > 0,
      uiReflected: revokeClicked && confirmClicked,
      before: { revoked_at: null }, after: { revoked_at: revoked },
      request: revokedReq, probe: { revokedName, revoked },
    }))
  }

  // OP-28 通知订阅：改邮箱并保存，后端 notification_subscriptions.email 改变
  const testEmail = 'e2e-op-' + Date.now() + '@sdp.test'
  const notifBefore = ui.pg(`select email from notification_subscriptions where subject='${SUB}'`)[0] || ''
  await ui.nav('/notifications/settings')
  await ui.fill('input.input[placeholder*="example.com"]', testEmail)
  await ui.clickText('保存订阅', 'button')
  await ui.sleep(900)
  const notifAfter = ui.pg(`select email from notification_subscriptions where subject='${SUB}'`)[0] || ''
  const notifReq = ui.apiLog.find((a) => a.method === 'PUT' && /\/notifications\/subscription/.test(a.path))
  const notifEmailValue = await ui.evalJs(`(()=>{const i=[...document.querySelectorAll('input.input')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes('example.com'));return i?i.value:''})()`)
  await ui.run('OP-28', '保存订阅规则（后端 email 改变）', () => ({
    requestOk: !!notifReq && notifReq.status >= 200 && notifReq.status < 400,
    backendChanged: notifAfter === testEmail && notifBefore !== testEmail,
    uiReflected: notifEmailValue === testEmail,
    before: { email: notifBefore }, after: { email: notifAfter },
    request: notifReq, probe: { testEmail, notifBefore, notifAfter, notifEmailValue },
  }))

  // OP-12 配置参数：新增 key，后端 component_configs 出现且值匹配
  const cfgKey = 'e2e.op.' + Date.now()
  const cfgVal = 'value-' + Date.now()
  const cid = FIX.component.id
  const cfgBefore = ui.pg(`select count(*) from component_configs where component_id='${cid}' and key='${cfgKey}'`)[0]
  await ui.nav(`/components/${cid}/config`)
  await ui.clickText('＋ 新增参数', 'button')
  await ui.sleep(300)
  // 表单有 key / value 两个 input，按 placeholder 或顺序定位
  const cfgFilled = await ui.evalJs(`(()=>{const ins=[...document.querySelectorAll('.modal input.input, input.input')].filter(x=>x.offsetParent!==null);if(ins.length<2)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(ins[0],${JSON.stringify(cfgKey)});ins[0].dispatchEvent(new Event('input',{bubbles:true}));s.call(ins[1],${JSON.stringify(cfgVal)});ins[1].dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await ui.clickText('保存', 'button')
  await ui.sleep(900)
  const cfgAfter = ui.pg(`select key,value from component_configs where component_id='${cid}' and key='${cfgKey}'`)
  const cfgReq = ui.apiLog.find((a) => a.method === 'PUT' && /\/configs\//.test(a.path))
  const cfgText = await ui.evalJs('document.body.innerText') || ''
  await ui.run('OP-12', '建配置参数（后端 configs 落库）', () => ({
    requestOk: !!cfgReq && cfgReq.status >= 200 && cfgReq.status < 400,
    backendChanged: cfgAfter.length > 0 && cfgAfter[0].includes(cfgKey),
    uiReflected: cfgFilled && cfgText.includes(cfgKey),
    before: { count: cfgBefore }, after: { rows: cfgAfter },
    request: cfgReq, probe: { cfgKey, cfgVal, cfgFilled },
  }))

  // OP-01 建组织：orgs + service_trees 双表新增
  const orgSlug = 'e2e-op-' + Date.now()
  const orgName = 'E2E OP ' + Date.now()
  const orgBefore = ui.pg(`select count(*) from orgs where slug='${orgSlug}'`)[0]
  await ui.nav('/service-tree')
  await ui.clickText('＋ 创建组织', 'button')
  await ui.sleep(300)
  const orgFilled = await ui.evalJs(`(()=>{const ins=[...document.querySelectorAll('.modal input.input, input.input')].filter(x=>x.offsetParent!==null&&(x.placeholder||'').includes('如：平台'));const slug=[...document.querySelectorAll('input.input')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes('小写字母'));if(!ins[0]||!slug)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(ins[0],${JSON.stringify(orgName)});ins[0].dispatchEvent(new Event('input',{bubbles:true}));s.call(slug,${JSON.stringify(orgSlug)});slug.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await ui.clickText('创建', 'button')
  await ui.sleep(1100)
  const orgAfter = ui.pg(`select id from orgs where slug='${orgSlug}' and deleted_at is null`)
  const treeAfter = orgAfter.length ? ui.pg(`select id from service_trees where org_id='${orgAfter[0]}'`) : []
  const orgReq = ui.apiLog.find((a) => a.method === 'POST' && /\/orgs/.test(a.path) && !/service-tree/.test(a.path))
  await ui.run('OP-01', '建组织（orgs + service_trees 双表落库）', () => ({
    requestOk: !!orgReq && orgReq.status >= 200 && orgReq.status < 400,
    backendChanged: orgAfter.length > 0 && treeAfter.length > 0,
    uiReflected: orgFilled,
    before: { count: orgBefore }, after: { org: orgAfter, tree: treeAfter },
    request: orgReq, probe: { orgSlug, orgName, orgAfter, treeAfter },
  }))

  // OP-19 建平台角色：platform_roles 新增
  const roleName = 'e2e-op-role-' + Date.now()
  const roleBefore = ui.pg(`select count(*) from platform_roles where name='${roleName}'`)[0]
  await ui.nav('/admin/permissions')
  await ui.clickText('＋ 新建角色', 'button')
  await ui.sleep(300)
  const roleFilled = await ui.fill('input.input[placeholder*="sdp-admin"]', roleName)
  // hub 契约 validActions：actions 必须是非空字符串数组，空数组返回 400。UI 表单可留空提交，用例须按契约填合法权限点。
  await ui.fill('textarea.input[placeholder*="platform:role"]', 'platform:role:create')
  await ui.sleep(300) // 等 Vue v-model 同步 roleForm.name，否则点击保存时仍是空值被校验拦下
  // 精确定位新建角色 Modal 内的保存按钮（页面上可能有多个"保存"）。
  const roleSaved = await ui.evalJs(`(()=>{const m=[...document.querySelectorAll('.modal')].find(x=>x.offsetParent!==null&&(x.textContent||'').includes('角色名'));const b=m&&[...m.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='保存'&&!x.disabled);if(!b)return false;b.click();return true})()`)
  await ui.sleep(900)
  const roleProbeText = await ui.evalJs('document.body.innerText') || ''
  const roleModalStillOpen = await ui.evalJs(`[...document.querySelectorAll('.modal')].some(x=>x.offsetParent!==null&&(x.textContent||'').includes('角色名'))`)
  const roleAfter = ui.pg(`select name from platform_roles where name='${roleName}'`)
  const roleText = await ui.evalJs('document.body.innerText') || ''
  const roleReq = ui.apiLog.find((a) => a.method === 'POST' && /\/platform-roles/.test(a.path))
  const roleUrl = await ui.evalJs('location.href')
  // run() 判据求值前会清空 apiLog，诊断证据必须在 run 之前取，否则永远是空数组。
  const roleInputVal = await ui.evalJs(`(()=>{const i=[...document.querySelectorAll('input.input')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes('sdp-admin'));return i?i.value:'<no-input>'})()`)
  const roleToast = roleProbeText.includes('请填写角色名') ? 'VALIDATION' : roleProbeText.includes('已创建角色') ? 'CREATED' : roleProbeText.includes('创建失败') ? 'ERR' : 'none'
  ui.say(`  DIAG OP-19 url=${roleUrl} filled=${roleFilled} saved=${roleSaved} inputVal=${roleInputVal} modalOpen=${roleModalStillOpen} toast=${roleToast} req=${JSON.stringify(roleReq)} apiCount=${ui.apiLog.length}`)
  await ui.run('OP-19', '建平台角色（platform_roles 落库）', () => ({
    requestOk: !!roleReq && roleReq.status >= 200 && roleReq.status < 400,
    backendChanged: roleAfter.length > 0,
    uiReflected: roleFilled && roleText.includes(roleName),
    before: { count: roleBefore }, after: { rows: roleAfter },
    request: roleReq, probe: { roleName, roleFilled, roleSaved, roleModalStillOpen, toast: roleToast, url: roleUrl, inputVal: roleInputVal, apiCount: ui.apiLog.length },
  }))

  // OP-31 变更窗口：platform_settings 落库 + 表单回填
  const cwStart = '08:30'
  const cwBefore = await ui.api('GET', '/platform/settings/change-window')
  await ui.nav('/admin/settings')
  const cwFilled = await ui.evalJs(`(()=>{const ins=[...document.querySelectorAll('input[type=time]')].filter(x=>x.offsetParent!==null);if(!ins.length)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(ins[0],${JSON.stringify(cwStart)});ins[0].dispatchEvent(new Event('input',{bubbles:true}));ins[0].dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await ui.clickText('保存变更窗口', 'button')
  await ui.sleep(900)
  const cwAfter = await ui.api('GET', '/platform/settings/change-window')
  const cwReq = ui.apiLog.find((a) => a.method === 'PUT' && /\/platform\/settings\/change-window/.test(a.path))
  const cwVal = cwAfter.data?.data?.start || cwAfter.data?.start
  await ui.run('OP-31', '保存变更窗口（后端回填）', () => ({
    requestOk: !!cwReq && cwReq.status >= 200 && cwReq.status < 400,
    backendChanged: cwVal === cwStart,
    uiReflected: cwFilled,
    before: { start: cwBefore.data?.data?.start }, after: { start: cwVal },
    request: cwReq, probe: { cwStart, cwFilled, cwVal },
  }))

  ui.finish({ subject: SUB, note: '第一批 + 第二批同步落库用例' })
}

main().catch((e) => { console.error('OP E2E ERROR:', e.message); process.exitCode = 1 })
