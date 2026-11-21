#!/usr/bin/env node
// UI 下发逻辑验证 · 服务树/配置/环境域：OP-02~05、OP-13/14、OP-15~18。
// 判据 = 请求正确 + 后端状态真实改变 + UI 反映（S 同步落库类）。
// 用法：node scripts/e2e-ops-tree.mjs
import { boot, finish, loadFixture } from './op-fixtures.mjs'

const FIX = loadFixture()
const CID = FIX.component.id

async function main() {
  const { ui, sub } = await boot('UI-OP-TREE')
  const now = Date.now()
  const slug = () => 'op-' + Math.random().toString(36).slice(2, 9)

  // 公共：在虚拟树里点选包含指定文本的节点（.tnode 的 .tname），返回是否命中。
  const pickNode = (text) => ui.evalJs(`(()=>{const n=[...document.querySelectorAll('.tnode')].find(x=>(x.querySelector('.tname')?.textContent||'').includes(${JSON.stringify(text)}));if(!n)return false;n.querySelector('.tname').click();return true})()`)
  // 公共：在当前可见 modal 内按 placeholder 前缀填值。
  const fillInModal = (ph, value) => ui.evalJs(`(()=>{const i=[...document.querySelectorAll('.modal input.input,.modal textarea.input')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes(${JSON.stringify(ph)}));if(!i)return false;const s=Object.getOwnPropertyDescriptor(i.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)

  // ---- OP-02 建服务（选中 Default 组织 → 添加服务） ----
  const svcKey = 'opsvc-' + slug()
  const svcName = 'OP服务' + now
  const svcBefore = ui.pg(`select count(*) from services where key='${svcKey}'`)[0]
  await ui.nav('/service-tree')
  const orgPicked = await pickNode('Default')
  await ui.clickText('＋ 添加服务', 'button')
  await ui.sleep(300)
  const svcFilled = (await fillInModal('user-center', svcKey)) && (await fillInModal('用户中心', svcName))
  await ui.clickText('创建', 'button')
  await ui.sleep(900)
  const svcAfter = ui.pg(`select id,key,name from services where key='${svcKey}'`)
  const svcReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/services')
  await ui.run('OP-02', '建服务（services 落库）', () => ({
    requestOk: !!svcReq && svcReq.status >= 200 && svcReq.status < 400,
    backendChanged: svcAfter.length > 0 && svcAfter[0].includes(svcKey),
    uiReflected: orgPicked && svcFilled,
    before: { count: svcBefore }, after: { rows: svcAfter }, request: svcReq,
    probe: { svcKey, svcName, orgPicked, svcFilled },
  }))

  // ---- OP-03 建组件（选中刚建的服务 → 添加组件） ----
  const compKey = 'opcomp-' + slug()
  const compName = 'OP组件' + now
  const compBefore = ui.pg(`select count(*) from components where key='${compKey}'`)[0]
  const svcPicked = svcAfter.length ? await pickNode(svcName) : false
  await ui.clickText('＋ 添加组件', 'button')
  await ui.sleep(300)
  const compFilled = (await fillInModal('user-api', compKey)) && (await fillInModal('用户服务 API', compName)) && (await fillInModal('github.com/org/repo.git', 'https://github.com/e2e/op.git'))
  await ui.clickText('创建', 'button')
  await ui.sleep(900)
  const compAfter = ui.pg(`select id,key,name from components where key='${compKey}'`)
  const compReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/components')
  await ui.run('OP-03', '建组件（components 落库）', () => ({
    requestOk: !!compReq && compReq.status >= 200 && compReq.status < 400,
    backendChanged: compAfter.length > 0 && compAfter[0].includes(compKey),
    uiReflected: svcPicked && compFilled,
    before: { count: compBefore }, after: { rows: compAfter }, request: compReq,
    probe: { compKey, compName, svcPicked, compFilled },
  }))

  // ---- OP-13 删配置参数（UI 删一个页面可见 key → 键消失 + history action=delete） ----
  // listConfigs 有 limit：新造的 key 未必在返回页内。改为取页面第一行可见配置作为被测 key，
  // 并通过 API 确保它存在（被测操作是「删」，选目标属于造数）。
  await ui.nav(`/components/${CID}/config`)
  await ui.sleep(700)
  // 从 API 精确取 key（DOM 第一列是 key+value 拼接，不能直接当 key）。
  const cfgList = (await ui.api('GET', `/components/${CID}/configs`)).data?.data
  const cfgArr = Array.isArray(cfgList) ? cfgList : (cfgList?.items || [])
  const delKey = (cfgArr.find((x) => !x.environmentId) || cfgArr[0])?.key || ''
  const delBefore = ui.pg(`select count(*) from component_configs where component_id='${CID}' and key='${delKey}' and environment_id is null`)[0]
  const delClicked = await ui.evalJs(`(()=>{const rows=[...document.querySelectorAll('tr')];const r=rows.find(x=>(x.querySelectorAll('td')[0]?.textContent||'').trim().startsWith(${JSON.stringify(delKey)}));if(!r)return false;const a=[...r.querySelectorAll('a')].find(x=>(x.textContent||'').trim()==='删除');if(!a)return false;a.click();return true})()`)
  await ui.sleep(900)
  const delAfter = ui.pg(`select count(*) from component_configs where component_id='${CID}' and key='${delKey}' and environment_id is null`)[0]
  const hist = ui.pg(`select action from component_config_history where component_id='${CID}' and key='${delKey}' order by changed_at desc limit 1`)
  const delReq = ui.apiLog.find((a) => a.method === 'DELETE' && new RegExp(`/configs/${delKey.replace(/\./g, '\\.')}`).test(a.path))
  await ui.run('OP-13', '删配置参数（键消失 + history delete）', () => ({
    requestOk: !!delReq && delReq.status >= 200 && delReq.status < 400,
    // 同名 key 可能因多轮造数残留重复行；判据取「行数减少 + delete 审计」而非强制清零。
    backendChanged: Number(delBefore) > 0 && Number(delAfter) < Number(delBefore) && hist[0] === 'delete',
    uiReflected: delClicked,
    before: { count: delBefore }, after: { count: delAfter, hist }, request: delReq,
    probe: { delKey, delClicked, hist },
  }))

  // ---- OP-15 建环境（两步向导：基本信息 → 接入方式/目标） ----
  const envKey = 'op-' + slug()
  const envName = 'OP环境' + now
  const envBefore = ui.pg(`select count(*) from environments where component_id='${CID}' and key='${envKey}'`)[0]
  const targetId = ui.pg(`select id from targets limit 1`)[0]
  await ui.nav(`/components/${CID}/environments`)
  await ui.clickText('＋ 新建环境', 'button')
  await ui.sleep(300)
  const wiz1 = (await fillInModal('如：生产环境', envName)) && (await fillInModal('如 prod', envKey))
  await ui.clickText('下一步', 'button')
  await ui.sleep(400)
  // Step2：保持默认「Agent 回连」（kubeconfig 模式会追加 apiserver/凭据必填项）。target 默认已选中，显式确认 + 填 namespace。
  const targetPicked = await ui.evalJs(`(()=>{const s=[...document.querySelectorAll('.modal select')].find(x=>[...x.options].some(o=>/local/i.test(o.textContent||'')));if(!s)return false;const o=[...s.options].find(x=>/local/i.test(x.textContent||''));if(!o)return false;s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  const nsFilled = await fillInModal('user-center-prod', 'op-ns-' + slug())
  const wiz2 = targetPicked && nsFilled
  await ui.clickText('创建', 'button')
  await ui.sleep(1100)
  const envAfter = ui.pg(`select id,key,name from environments where component_id='${CID}' and key='${envKey}'`)
  const envReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/environments')
  await ui.run('OP-15', '建环境（environments 落库）', () => ({
    requestOk: !!envReq && envReq.status >= 200 && envReq.status < 400,
    backendChanged: envAfter.length > 0 && envAfter[0].includes(envKey),
    uiReflected: wiz1 && wiz2 && targetPicked,
    before: { count: envBefore, targetId }, after: { rows: envAfter }, request: envReq,
    probe: { envKey, envName, wiz1, wiz2, targetPicked, envReqBody: envReq?.body },
  }))

  // ---- OP-04 声明依赖（造两个同服务组件，UI 在 overview 声明） ----
  const svcGw = '0517dd2f-d429-486f-970c-84ef8922ce97'
  const depA = 'opa-' + slug(), depB = 'opb-' + slug()
  await ui.api('POST', '/components', { serviceId: svcGw, key: depA, name: '依赖A' + now, repoUrl: 'https://github.com/e2e/a.git' })
  await ui.api('POST', '/components', { serviceId: svcGw, key: depB, name: '依赖B' + now, repoUrl: 'https://github.com/e2e/b.git' })
  const idA = ui.pg(`select id from components where key='${depA}'`)[0]
  const idB = ui.pg(`select id from components where key='${depB}'`)[0]
  const depBefore = ui.pg(`select count(*) from component_dependencies where component_id='${idA}'`)[0]
  await ui.nav(`/components/${idA}/overview`)
  // 下拉选兄弟组件「依赖B」，再点「添加」。
  const depSelected = await ui.evalJs(`(()=>{const s=[...document.querySelectorAll('select.select')].find(x=>[...x.options].some(o=>(o.textContent||'').includes('声明依赖')));if(!s)return false;const o=[...s.options].find(x=>(x.textContent||'').includes(${JSON.stringify('依赖B'+now)}));if(!o)return false;s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await ui.clickText('添加', 'button')
  await ui.sleep(900)
  const depAfter = ui.pg(`select id,depends_on_id from component_dependencies where component_id='${idA}' and depends_on_id='${idB}'`)
  const depReq = ui.apiLog.find((a) => a.method === 'POST' && /\/components\/[^/]+\/dependencies/.test(a.path))
  await ui.run('OP-04', '声明依赖（component_dependencies 落库）', () => ({
    requestOk: !!depReq && depReq.status >= 200 && depReq.status < 400,
    backendChanged: depAfter.length > 0 && depAfter[0].includes(idB),
    uiReflected: depSelected,
    before: { count: depBefore }, after: { rows: depAfter }, request: depReq,
    probe: { depA, depB, idA, idB, depSelected, depReqBody: depReq?.body },
  }))

  // ---- OP-05 解除依赖（硬删） ----
  const unlinkClicked = await ui.evalJs(`(()=>{const rows=[...document.querySelectorAll('.dep-row')];const r=rows.find(x=>(x.textContent||'').includes(${JSON.stringify('依赖B'+now)}));if(!r)return false;const b=[...r.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='解除');if(!b)return false;b.click();return true})()`)
  await ui.sleep(900)
  const depGone = ui.pg(`select count(*) from component_dependencies where component_id='${idA}' and depends_on_id='${idB}'`)[0]
  const delDepReq = ui.apiLog.find((a) => a.method === 'DELETE' && /\/components\/[^/]+\/dependencies/.test(a.path))
  await ui.run('OP-05', '解除依赖（硬删落库）', () => ({
    requestOk: !!delDepReq && delDepReq.status >= 200 && delDepReq.status < 400,
    backendChanged: Number(depGone) === 0,
    uiReflected: unlinkClicked,
    before: { count: 1 }, after: { count: depGone }, request: delDepReq,
    probe: { unlinkClicked, idA, idB },
  }))

  // ---- OP-14 配置回滚（建 v1→改 v2→UI 回滚到 v1，生成新快照） ----
  const rbKey = 'oprb.' + slug()
  const rbTag = 'RB-' + now
  await ui.api('PUT', `/components/${CID}/configs/${rbKey}`, { value: 'v1' })
  await ui.api('PUT', `/components/${CID}/configs/${rbKey}`, { value: 'v2' })
  // 快照是全局 scope（scope_key 为空），不是按单 key；回滚目标=当前全局最新版本。
  const rbBefore = ui.pg(`select version from component_config_snapshots where component_id='${CID}' order by version desc limit 1`)[0]
  await ui.nav(`/components/${CID}/config`)
  await ui.clickText('⟳ 版本历史', 'button')
  await ui.sleep(400)
  // 抽屉里点「回滚到此版」（非当前版那行），再填高危原因并确认。
  const rbPick = await ui.evalJs(`(()=>{const a=[...document.querySelectorAll('.drawer a,aside.drawer a')].find(x=>(x.textContent||'').includes('回滚到此版')&&!x.disabled);if(!a)return false;a.click();return true})()`)
  await ui.sleep(400)
  const rbReason = await ui.fill('textarea[placeholder*="发布单"]', rbTag)
  await ui.clickText('确认回滚', 'button')
  await ui.sleep(1000)
  const rbAfter = ui.pg(`select version,comment from component_config_snapshots where component_id='${CID}' and comment like '%${rbTag}%' order by version desc limit 1`)
  const rbReq = ui.apiLog.find((a) => a.method === 'POST' && /\/config-versions\/\d+\/rollback/.test(a.path))
  await ui.run('OP-14', '配置回滚（新快照 + 原因入 comment）', () => ({
    requestOk: !!rbReq && rbReq.status >= 200 && rbReq.status < 400,
    backendChanged: rbAfter.length > 0 && Number(rbAfter[0].split('|')[0]) > Number(rbBefore || 0),
    uiReflected: rbPick && rbReason,
    before: { version: rbBefore }, after: { row: rbAfter }, request: rbReq,
    probe: { rbKey, rbPick, rbReason, rbReqBody: rbReq?.body },
  }))

  // ---- OP-16 建环境分组（原生 prompt 输入名称） ----
  const grpName = 'OP分组' + now
  const grpBefore = ui.pg(`select count(*) from environment_groups where component_id='${CID}' and name='${grpName}'`)[0]
  await ui.nav(`/components/${CID}/environments`)
  const grpPrompted = await ui.withDialog(
    (p) => ({ accept: true, text: grpName }),
    () => ui.clickText('＋ 分组', 'button,a'),
  )
  await ui.sleep(900)
  const grpAfter = ui.pg(`select id,name from environment_groups where component_id='${CID}' and name='${grpName}'`)
  const grpReq = ui.apiLog.find((a) => a.method === 'POST' && /\/environment-groups/.test(a.path))
  await ui.run('OP-16', '建环境分组（environment_groups 落库）', () => ({
    requestOk: !!grpReq && grpReq.status >= 200 && grpReq.status < 400,
    backendChanged: grpAfter.length > 0,
    uiReflected: grpPrompted,
    before: { count: grpBefore }, after: { rows: grpAfter }, request: grpReq,
    probe: { grpName, grpPrompted },
  }))

  // ---- OP-17 保存环境对接配置（选中环境 → 改名称 → 保存） ----
  const envId = envAfter.length ? envAfter[0].split('|')[0] : null
  const renamed = 'OP对接' + now
  let envNameAfter = ''
  if (envId) {
    await ui.nav(`/components/${CID}/environments`)
    const envPicked = await ui.evalJs(`(()=>{const n=[...document.querySelectorAll('.env-row')].find(x=>(x.textContent||'').includes(${JSON.stringify(envName)}));if(!n)return false;n.click();return true})()`)
    await ui.sleep(400)
    // panel 环境名称 input：值为当前环境名的文本 input（原型 setter 赋值触发 v-model）。
    const nameFilled = await ui.evalJs(`(()=>{const i=[...document.querySelectorAll('.env-main input[type=text],aside input[type=text],input.input')].find(x=>x.offsetParent!==null&&(x.value||'').includes(${JSON.stringify(envName)}));if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(renamed)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
    const saved = await ui.clickText('保存配置', 'button')
    await ui.sleep(900)
    envNameAfter = ui.pg(`select name from environments where id='${envId}'`)[0] || ''
    const saveReq = ui.apiLog.find((a) => a.method === 'PUT' && new RegExp(`/environments/${envId}`).test(a.path))
    await ui.run('OP-17', '保存环境对接配置（environments.name 落库）', () => ({
      requestOk: !!saveReq && saveReq.status >= 200 && saveReq.status < 400,
      backendChanged: envNameAfter === renamed,
      uiReflected: envPicked && nameFilled && saved,
      before: { name: envKey }, after: { name: envNameAfter }, request: saveReq,
      probe: { envId, envKey, envPicked, nameFilled, saved, renamed },
    }))
  }

  // ---- OP-18 运行连接测试（Agent 回连环境下点测试，状态落库） ----
  if (envId) {
    await ui.nav(`/components/${CID}/environments`)
    const envPicked = await ui.evalJs(`(()=>{const n=[...document.querySelectorAll('.env-row')].find(x=>{const t=x.textContent||'';return t.includes(${JSON.stringify(renamed)})||t.includes(${JSON.stringify(envName)})});if(!n)return false;n.click();return true})()`)
    await ui.sleep(400)
    const testClicked = await ui.clickText('▷ 运行连接测试', 'button')
    await ui.sleep(1200)
    const testReq = ui.apiLog.find((a) => a.method === 'POST' && new RegExp(`/environments/${envId}/test`).test(a.path))
    const envState = ui.pg(`select status,last_test_result from environments where id='${envId}'`)[0] || ''
    await ui.run('OP-18', '运行连接测试（status/last_test_result 落库）', () => ({
      requestOk: !!testReq && testReq.status >= 200 && testReq.status < 400,
      backendChanged: envState.length > 0 && !envState.startsWith('|'),
      uiReflected: envPicked && testClicked,
      before: { status: 'configured_unverified' }, after: { state: envState }, request: testReq,
      probe: { envId, envPicked, testClicked, envState },
    }))
  }

  finish(ui, 'UI-OP-TREE', { note: '第二批：服务树/配置/环境域（S 同步落库）', fixture: { componentId: CID } })
}

main().catch((e) => { console.error('OP TREE ERROR:', e.message); process.exitCode = 1 })
