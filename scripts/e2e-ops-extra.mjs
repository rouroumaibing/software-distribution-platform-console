#!/usr/bin/env node
// UI 下发逻辑验证 · 补充域：OP-10/11（编排重排/版本回滚）、OP-22（组件权限绑定）、
// OP-23（集群权限）、OP-29（变量组绑定）。判据 = 请求 + 后端落库 + UI 反映。
// 用法：node scripts/e2e-ops-extra.mjs
import { readFileSync } from 'node:fs'
import { boot, finish, loadFixture } from './op-fixtures.mjs'

const FIX = loadFixture()
const CID = FIX.component.id
const PID = FIX.pipeline.id

// 集群权限下发要求环境带 kubeconfig 凭据（hub 会真写 K8s 资源）。用 kind
// 自身 kubeconfig：client 证书/CA 不变，server 换成集群内 DNS（hub pod 可达）。
function kindKubeconfig() {
  const raw = readFileSync(new URL('../../.kubeconfig', import.meta.url), 'utf8')
  return raw.replace(/server:\s*https:\/\/[^\s]+/, 'server: https://kubernetes.default.svc.cluster.local')
}

async function main() {
  const { ui, sub } = await boot('UI-OP-EXTRA')
  const now = Date.now()
  const slug = () => Math.random().toString(36).slice(2, 8)
  const fillInModal = (ph, value) => ui.evalJs(`(()=>{const i=[...document.querySelectorAll('.modal input,.modal textarea')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes(${JSON.stringify(ph)}));if(!i)return false;const s=Object.getOwnPropertyDescriptor(i.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)

  // ---- OP-22 组件权限绑定（造一个组件角色 → UI 在组件权限页绑定 admin） ----
  const crName = 'opextracr-' + slug()
  await ui.api('POST', '/component-roles', { name: crName, description: '', actions: ['page:overview:view'] })
  const crId = ui.pg(`select id from component_roles where name='${crName}'`)[0]
  const bindBefore = ui.pg(`select count(*) from component_role_bindings where component_id='${CID}' and subject_id='${sub}'`)[0]
  if (crId) {
    await ui.nav(`/components/${CID}/permissions`)
    await ui.clickText('＋ 添加绑定', 'button')
    await ui.sleep(400)
    const bindFilled = (await fillInModal('Keycloak 用户详情里的 sub', sub)) && await ui.evalJs(`(()=>{const s=[...document.querySelectorAll('.modal select')].find(x=>[...x.options].some(o=>(o.textContent||'').includes(${JSON.stringify(crName)})));if(!s)return false;const o=[...s.options].find(x=>(x.textContent||'').includes(${JSON.stringify(crName)}));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
    await ui.clickText('保存', 'button')
    await ui.sleep(900)
    const bindAfter = ui.pg(`select id,subject_id,component_role_id from component_role_bindings where component_id='${CID}' and subject_id='${sub}'`)
    const bindReq = ui.apiLog.find((a) => a.method === 'POST' && /\/components\/[^/]+\/role-bindings/.test(a.path))
    await ui.run('OP-22', '组件权限绑定（component_role_bindings 落库）', () => ({
      requestOk: !!bindReq && bindReq.status >= 200 && bindReq.status < 400,
      backendChanged: bindAfter.length > Number(bindBefore),
      uiReflected: bindFilled,
      before: { count: bindBefore }, after: { rows: bindAfter }, request: bindReq,
      probe: { crName, crId, bindFilled, bindReqBody: bindReq?.body },
    }))
  }

  // ---- OP-29 变量组绑定（造变量组 → UI 在组件变量页绑定） ----
  const orgId = ui.pg(`select id from orgs where slug='default'`)[0]
  const vgName = 'opvg-' + slug()
  await ui.api('POST', '/variable-groups', { orgId, name: vgName, description: '', variables: [] })
  const vgId = ui.pg(`select id from variable_groups where name='${vgName}'`)[0]
  const vgBefore = ui.pg(`select count(*) from component_variable_group_bindings where component_id='${CID}'`)[0]
  if (vgId) {
    await ui.nav(`/components/${CID}/vars`)
    const bound = await ui.evalJs(`(()=>{const rows=[...document.querySelectorAll('tr')];const r=rows.find(x=>(x.textContent||'').includes(${JSON.stringify(vgName)}));if(!r)return false;const a=[...r.querySelectorAll('a')].find(x=>(x.textContent||'').trim()==='绑定');if(!a)return false;a.click();return true})()`)
    await ui.sleep(900)
    const vgAfter = ui.pg(`select id,group_id from component_variable_group_bindings where component_id='${CID}' and group_id='${vgId}'`)
    const vgReq = ui.apiLog.find((a) => a.method === 'POST' && /\/components\/[^/]+\/variable-group-bindings/.test(a.path))
    await ui.run('OP-29', '变量组绑定（binding 落库）', () => ({
      requestOk: !!vgReq && vgReq.status >= 200 && vgReq.status < 400,
      backendChanged: vgAfter.length > 0,
      uiReflected: bound,
      before: { count: vgBefore }, after: { rows: vgAfter }, request: vgReq,
      probe: { vgName, vgId, bound, vgReqBody: vgReq?.body },
    }))
  }

  // ---- OP-23 集群权限建（环境 + admin sub） ----
  // 集群权限下发要求环境为 kubeconfig 直连且凭据非空（hub 会真写 K8s 资源），
  // 造数 = 建 kubeconfig 凭据 + kubeconfig 模式环境；新建也保证环境下拉有该选项。
  const envKey = 'opcb-' + slug()
  const credResp = await ui.api('POST', '/credentials', { name: 'opcb-kc-' + slug(), type: 'kubeconfig', value: kindKubeconfig() })
  const credId = credResp?.data?.data?.id || ui.pg(`select id from credentials where name like 'opcb-kc-%' order by created_at desc limit 1`)[0]
  await ui.api('POST', '/environments', { componentId: CID, key: envKey, name: 'OP集群' + now, envType: 'test', targetId: ui.pg(`select id from targets limit 1`)[0], namespace: 'op-cb-' + slug(), access: 'kubeconfig', accessConfig: { kubeCredRef: credId } })
  const envId = ui.pg(`select id from environments where key='${envKey}'`)[0]
  const cbBefore = ui.pg(`select count(*) from cluster_bindings where subject_id='${sub}' and environment_id='${envId}'`)[0]
  if (envId) {
    await ui.nav('/admin/cluster-permissions')
    await ui.clickText('新建集群权限', 'button')
    await ui.sleep(400)
    const cbFilled = await ui.evalJs(`(()=>{const m=[...document.querySelectorAll('.modal')].find(x=>x.offsetParent!==null);if(!m)return false;const sels=[...m.querySelectorAll('select')];const ins=[...m.querySelectorAll('input')];if(sels.length<3||ins.length<2)return false;const envOpt=[...sels[0].options].find(o=>o.value===${JSON.stringify(envId)});if(!envOpt)return false;sels[0].value=${JSON.stringify(envId)};sels[0].dispatchEvent(new Event('change',{bubbles:true}));sels[1].value='user';sels[1].dispatchEvent(new Event('change',{bubbles:true}));sels[2].value='readonly';sels[2].dispatchEvent(new Event('change',{bubbles:true}));const sv=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const setV=(el,v)=>{sv.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};setV(ins[0],${JSON.stringify(sub)});setV(ins[1],'E2E OP');const ns=[...m.querySelectorAll('input')].find(x=>(x.placeholder||'')==='namespace');if(ns)setV(ns,'e2e-ns');const cs=[...m.querySelectorAll('input[type=checkbox]')][0];if(cs&&!cs.checked)cs.click();return true})()`)
    await ui.clickText('创建', 'button')
    await ui.sleep(1100)
    const cbAfter = ui.pg(`select id,subject_id,role,status from cluster_bindings where subject_id='${sub}' and environment_id='${envId}'`)
    const cbReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/cluster-permissions')
    await ui.run('OP-23', '建集群权限（cluster_bindings 落库）', () => ({
      requestOk: !!cbReq && cbReq.status >= 200 && cbReq.status < 400,
      backendChanged: cbAfter.length > Number(cbBefore),
      uiReflected: cbFilled,
      before: { count: cbBefore }, after: { rows: cbAfter }, request: cbReq,
      probe: { envId, cbFilled, cbReqBody: cbReq?.body },
    }))
  }

  // ---- OP-10 编排重排落库（阶段 executionMode 并行→串行 + 确认保存） ----
  const stages = ui.pg(`select id,execution_mode from pipeline_stages where pipeline_id='${PID}' and deleted_at is null order by sequence`)
  if (stages.length) {
    const stId = stages[0].split('|')[0]
    await ui.nav(`/pipelines/${PID}`)
    await ui.sleep(500)
    const modeToggled = await ui.evalJs(`(()=>{const b=[...document.querySelectorAll('button.mini')].find(x=>(x.title||'').includes('executionMode'));if(!b)return false;b.click();return true})()`)
    await ui.sleep(300)
    const dirtyShown = (await ui.evalJs('document.body.innerText') || '').includes('未保存改动')
    await ui.clickText('编辑信息', 'button')
    await ui.sleep(300)
    await ui.clickText('去保存', 'button')
    await ui.sleep(300)
    await ui.clickText('确认保存', 'button')
    await ui.sleep(1000)
    const modeAfter = ui.pg(`select execution_mode from pipeline_stages where id='${stId}'`)[0]
    const saveReq = ui.apiLog.find((a) => a.method === 'PUT' && /\/stages\/[^/]+/.test(a.path))
    await ui.run('OP-10', '编排重排落库（executionMode 改变）', () => ({
      requestOk: !!saveReq && saveReq.status >= 200 && saveReq.status < 400,
      backendChanged: modeAfter.length > 0 && modeAfter !== stages[0].split('|')[1],
      uiReflected: modeToggled && dirtyShown,
      before: { mode: stages[0].split('|')[1] }, after: { mode: modeAfter }, request: saveReq,
      probe: { stId, modeToggled, dirtyShown },
    }))
  }

  // ---- OP-11 版本回滚（已有 ≥2 版本 → UI 回滚到旧版，新增快照） ----
  const verCount = Number(ui.pg(`select count(*) from pipeline_versions where pipeline_id='${PID}'`)[0] || 0)
  if (verCount >= 2) {
    const verBefore = Number(ui.pg(`select version from pipelines where id='${PID}'`)[0] || 0)
    await ui.nav(`/pipelines/${PID}`)
    await ui.clickText('版本历史', 'button')
    await ui.sleep(500)
    const rollbackPicked = await ui.evalJs(`(()=>{const b=[...document.querySelectorAll('.vh-acts button')].find(x=>(x.textContent||'').includes('回滚到此版')&&!x.disabled);if(!b)return false;b.click();return true})()`)
    await ui.sleep(300)
    await ui.clickText('确认回滚', 'button')
    await ui.sleep(1000)
    const verAfter = Number(ui.pg(`select version from pipelines where id='${PID}'`)[0] || 0)
    const rbReq = ui.apiLog.find((a) => a.method === 'POST' && /\/versions\/\d+\/rollback/.test(a.path))
    await ui.run('OP-11', '版本回滚（新版本快照）', () => ({
      requestOk: !!rbReq && rbReq.status >= 200 && rbReq.status < 400,
      backendChanged: verAfter > verBefore,
      uiReflected: rollbackPicked,
      before: { version: verBefore, snapshots: verCount }, after: { version: verAfter }, request: rbReq,
      probe: { rollbackPicked, verBefore, verAfter },
    }))
  } else {
    ui.say(`  SKIP OP-11: 版本快照不足（${verCount}），无可回滚版本`)
  }

  finish(ui, 'UI-OP-EXTRA', { note: '补充批：组件绑定/变量组/集群权限/编排重排/版本回滚', fixture: { componentId: CID, pipelineId: PID } })
}

main().catch((e) => { console.error('OP EXTRA ERROR:', e.message); process.exitCode = 1 })
