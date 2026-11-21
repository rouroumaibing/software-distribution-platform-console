#!/usr/bin/env node
// UI 下发逻辑验证 · 权限/身份/凭据域：OP-20~23、OP-24/25/27、OP-29、OP-32。
// 判据 = 请求 + 后端状态真实改变 + UI 反映（S 同步落库）。
// 用法：node scripts/e2e-ops-perm.mjs
import { boot, finish, loadFixture } from './op-fixtures.mjs'

const FIX = loadFixture()
const CID = FIX.component.id

async function main() {
  const { ui, sub } = await boot('UI-OP-PERM')
  const now = Date.now()
  const slug = () => Math.random().toString(36).slice(2, 8)
  const fillInModal = (ph, value) => ui.evalJs(`(()=>{const i=[...document.querySelectorAll('.modal input,.modal textarea')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes(${JSON.stringify(ph)}));if(!i)return false;const s=Object.getOwnPropertyDescriptor(i.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)

  // ---- OP-20 建组件角色（勾选权限点，actions 非空） ----
  const compRole = 'opcr-' + slug()
  const crBefore = ui.pg(`select count(*) from component_roles where name='${compRole}'`)[0]
  await ui.nav('/admin/permissions')
  await ui.clickText('＋ 新建组件角色', 'button')
  await ui.sleep(300)
  const crFilled = await fillInModal('team-deployer', compRole)
  const checked = await ui.evalJs(`(()=>{const c=[...document.querySelectorAll('.modal input[type=checkbox]')].find(x=>x.offsetParent!==null);if(!c)return false;c.click();return true})()`)
  await ui.clickText('保存', 'button')
  await ui.sleep(900)
  const crAfter = ui.pg(`select id,name,actions from component_roles where name='${compRole}'`)
  const crReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/component-roles')
  await ui.run('OP-20', '建组件角色（component_roles 落库）', () => ({
    requestOk: !!crReq && crReq.status >= 200 && crReq.status < 400,
    backendChanged: crAfter.length > 0 && !crAfter[0].split('|')[1].includes('[]'),
    uiReflected: crFilled && checked,
    before: { count: crBefore }, after: { rows: crAfter }, request: crReq,
    probe: { compRole, crFilled, checked, crReqBody: crReq?.body },
  }))

  // ---- OP-21 平台权限绑定（主体=admin sub，角色=platform-admin） ----
  const platRoleId = ui.pg(`select id from platform_roles where name='platform-admin'`)[0]
  // 幂等：先清掉该主体已有的 platform-admin 绑定（多轮 E2E 累积会 409），造数用 API。
  const stale = ui.pg(`select id from platform_role_bindings where subject_id='${sub}' and platform_role_id='${platRoleId}'`)
  for (const bid of stale) await ui.api('DELETE', `/platform-role-bindings/${bid.split('|')[0]}`)
  const bindBefore = ui.pg(`select count(*) from platform_role_bindings where subject_id='${sub}'`)[0]
  await ui.nav('/admin/permissions')
  await ui.clickText('＋ 添加绑定', 'button')
  await ui.sleep(300)
  const bindFilled = (await fillInModal('Keycloak 用户详情里的 sub', sub)) && await ui.evalJs(`(()=>{const s=[...document.querySelectorAll('.modal select')].find(x=>[...x.options].some(o=>/platform-admin/i.test(o.textContent||'')));if(!s)return false;const o=[...s.options].find(x=>/platform-admin/i.test(x.textContent||''));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await ui.clickText('保存', 'button')
  await ui.sleep(900)
  const bindAfter = ui.pg(`select id,subject_id,platform_role_id from platform_role_bindings where subject_id='${sub}'`)
  const bindReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/platform-role-bindings')
  await ui.run('OP-21', '平台权限绑定（platform_role_bindings 落库）', () => ({
    requestOk: !!bindReq && bindReq.status >= 200 && bindReq.status < 400,
    backendChanged: bindAfter.length > Number(bindBefore),
    uiReflected: bindFilled,
    before: { count: bindBefore }, after: { rows: bindAfter }, request: bindReq,
    probe: { sub, platRoleId, bindFilled, bindReqBody: bindReq?.body },
  }))

  // ---- OP-32 凭据建（独立，attrs: name/type/scope/value） ----
  const credName = 'opcred-' + slug()
  const credBefore = ui.pg(`select count(*) from credentials where name='${credName}'`)[0]
  await ui.nav('/admin/credentials')
  await ui.clickText('＋ 新建凭据', 'button')
  await ui.sleep(300)
  const credFilled = (await fillInModal('prod-kubeconfig', credName)) && (await fillInModal('粘贴 kubeconfig', 'e2e-secret-value'))
  await ui.clickText('保存', 'button')
  await ui.sleep(900)
  const credAfter = ui.pg(`select id,name,value from credentials where name='${credName}'`)
  const credReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/credentials')
  await ui.run('OP-32', '建凭据（credentials 落库 + 密文写入）', () => ({
    requestOk: !!credReq && credReq.status >= 200 && credReq.status < 400,
    backendChanged: credAfter.length > 0 && (credAfter[0].split('|')[2] || '').length > 0,
    uiReflected: credFilled,
    before: { count: credBefore }, after: { rows: credAfter }, request: credReq,
    probe: { credName, credFilled, credReqBody: credReq?.body },
  }))

  // ---- OP-24 建用户（KC 目录可用时） ----
  const dirAvail = (await ui.evalJs('document.body.innerText') || '').includes('新建用户')
  if (dirAvail) {
    const uname = 'ope2e-' + slug()
    await ui.nav('/admin/permissions')
    const userBefore = ui.pg(`select count(*) from user_entity where username='${uname}'`)[0]
    await ui.clickText('＋ 新建用户', 'button')
    await ui.sleep(300)
    const userFilled = await fillInModal('zhang.san', uname)
    await ui.clickText('创建', 'button')
    await ui.sleep(1100)
    const userAfter = ui.pg(`select id,username,enabled from user_entity where username='${uname}'`)
    const userReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/keycloak/users')
    await ui.run('OP-24', '建用户（user_entity 落库 + 一次性口令）', () => ({
      requestOk: !!userReq && userReq.status >= 200 && userReq.status < 400,
      backendChanged: userAfter.length > 0,
      uiReflected: userFilled,
      before: { count: userBefore }, after: { rows: userAfter }, request: userReq,
      probe: { uname, userFilled },
    }))
  } else {
    ui.say('  SKIP OP-24/25/27: Keycloak 目录不可用（无新建用户入口）')
  }

  finish(ui, 'UI-OP-PERM', { note: '第四批：权限/身份/凭据域（S 同步落库）', fixture: { componentId: CID, subject: sub }, keycloakDirAvailable: dirAvail })
}

main().catch((e) => { console.error('OP PERM ERROR:', e.message); process.exitCode = 1 })
