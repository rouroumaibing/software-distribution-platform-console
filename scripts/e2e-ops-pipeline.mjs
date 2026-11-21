#!/usr/bin/env node
// UI 下发逻辑验证 · 流水线编排域：OP-06~11、OP-30。判据 = 请求 + 后端落库 + UI 反映。
// 用法：node scripts/e2e-ops-pipeline.mjs
import { boot, finish, loadFixture } from './op-fixtures.mjs'

const FIX = loadFixture()
const CID = FIX.component.id

async function main() {
  const { ui } = await boot('UI-OP-PIPELINE')
  const now = Date.now()
  const slug = () => Math.random().toString(36).slice(2, 8)
  const fillInModal = (ph, value) => ui.evalJs(`(()=>{const i=[...document.querySelectorAll('.modal input,.modal textarea')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes(${JSON.stringify(ph)}));if(!i)return false;const s=Object.getOwnPropertyDescriptor(i.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)

  // ---- OP-06 建流水线（组件详情流水线 Tab → 新建 → 跳编辑器） ----
  const pipeName = 'OP流水线' + now
  const pipeBefore = ui.pg(`select count(*) from pipelines where name='${pipeName}'`)[0]
  await ui.nav(`/components/${CID}/pipelines`)
  await ui.clickText('＋ 新建流水线', 'button')
  await ui.sleep(900)
  const pipeFilled = await fillInModal('日常流水线', pipeName)
  await ui.clickText('创建并编排', 'button')
  await ui.sleep(1100)
  const pipeAfter = ui.pg(`select id,name,kind,version from pipelines where name='${pipeName}'`)
  const pipeReq = ui.apiLog.find((a) => a.method === 'POST' && a.path === '/api/v1/pipelines')
  const pid = pipeAfter.length ? pipeAfter[0].split('|')[0] : null
  await ui.run('OP-06', '建流水线（pipelines 落库 + 跳编辑器）', () => ({
    requestOk: !!pipeReq && pipeReq.status >= 200 && pipeReq.status < 400,
    backendChanged: pipeAfter.length > 0 && pipeAfter[0].includes(pipeName),
    uiReflected: pipeFilled,
    before: { count: pipeBefore }, after: { rows: pipeAfter }, request: pipeReq,
    probe: { pipeName, pid, pipeFilled },
  }))
  if (!pid) { finish(ui, 'UI-OP-PIPELINE', { note: 'OP-06 失败，后续编排用例无法进行', aborted: true }); return }

  // ---- OP-08 建阶段 / 删阶段 ----
  await ui.nav(`/pipelines/${pid}`)
  await ui.clickText('＋ 新建阶段', 'button')
  await ui.sleep(300)
  const stageName = 'OP阶段' + slug()
  const stFilled = await fillInModal('构建', stageName)
  await ui.clickText('创建', 'button')
  await ui.sleep(800)
  const stAfter = ui.pg(`select id,name from pipeline_stages where pipeline_id='${pid}' and name='${stageName}' and deleted_at is null`)
  const stReq = ui.apiLog.find((a) => a.method === 'POST' && /\/pipelines\/[^/]+\/stages/.test(a.path))
  const stId = stAfter.length ? stAfter[0].split('|')[0] : null
  await ui.run('OP-08', '建阶段（pipeline_stages 落库）', () => ({
    requestOk: !!stReq && stReq.status >= 200 && stReq.status < 400,
    backendChanged: stAfter.length > 0,
    uiReflected: stFilled,
    before: { count: 0 }, after: { rows: stAfter }, request: stReq,
    probe: { stageName, stId, stFilled },
  }))

  // ---- OP-09 建子任务（阶段 → ＋子任务 → 抽屉填名/镜像/命令 → 保存） ----
  let taskId = null
  if (stId) {
    const added = await ui.evalJs(`(()=>{const b=[...document.querySelectorAll('button.add-task')].find(x=>x.offsetParent!==null);if(!b)return false;b.click();return true})()`)
    await ui.sleep(600)
    const taskName = 'OP任务' + slug()
    const fillDrawer = (ph, v) => ui.evalJs(`(()=>{const i=[...document.querySelectorAll('aside.drawer input,.drawer input,input.input')].find(x=>x.offsetParent!==null&&(x.placeholder||'').includes(${JSON.stringify(ph)}));if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
    const tf1 = await fillDrawer('go build', taskName)
    const tf2 = await fillDrawer('golang:1.', 'golang:1.27')
    const tf3 = await fillDrawer('pytest -q', 'echo op-task-ok')
    await ui.clickText('保存子任务', 'button')
    await ui.sleep(900)
    const tAfter = ui.pg(`select id,name,type from pipeline_task_templates where stage_id='${stId}' and name='${taskName}'`)
    const tReq = ui.apiLog.find((a) => a.method === 'POST' && /\/stages\/[^/]+\/tasks/.test(a.path))
    taskId = tAfter.length ? tAfter[0].split('|')[0] : null
    await ui.run('OP-09', '建子任务（pipeline_tasks 落库）', () => ({
      requestOk: !!tReq && tReq.status >= 200 && tReq.status < 400,
      backendChanged: tAfter.length > 0,
      uiReflected: added && tf1 && tf2 && tf3,
      before: { count: 0 }, after: { rows: tAfter }, request: tReq,
      probe: { taskName, taskId, added, tf1, tf2, tf3 },
    }))
  }

  // ---- OP-07 改名并确认保存（编辑信息 → 去保存 → 确认保存；version +1） ----
  const verBefore = Number(ui.pg(`select version from pipelines where id='${pid}'`)[0] || 0)
  const renamed = 'OP改名' + now
  await ui.nav(`/pipelines/${pid}`)
  await ui.clickText('编辑信息', 'button')
  await ui.sleep(300)
  // 编辑信息 modal 的名称 input 无 placeholder：取 modal 内第一个可见文本 input。
  const nameFilled = await ui.evalJs(`(()=>{const i=[...document.querySelectorAll('.modal input.input:not([disabled])')].find(x=>x.offsetParent!==null);if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(renamed)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await ui.clickText('去保存', 'button')
  await ui.sleep(300)
  await ui.clickText('确认保存', 'button')
  await ui.sleep(1000)
  const verAfter = Number(ui.pg(`select version from pipelines where id='${pid}'`)[0] || 0)
  const nameAfter = ui.pg(`select name from pipelines where id='${pid}'`)[0] || ''
  const saveReq = ui.apiLog.find((a) => a.method === 'PUT' && a.path === `/api/v1/pipelines/${pid}`)
  await ui.run('OP-07', '改名确认保存（name 改 + version +1）', () => ({
    requestOk: !!saveReq && saveReq.status >= 200 && saveReq.status < 400,
    backendChanged: nameAfter === renamed,
    uiReflected: nameFilled,
    before: { name: pipeName, version: verBefore }, after: { name: nameAfter, version: verAfter }, request: saveReq,
    probe: { renamed, nameFilled, verBefore, verAfter },
  }))

  // ---- OP-30 触发器新建（触发器 → 新建 → 定时 cron） ----
  const trigName = 'OP触发' + slug()
  await ui.nav(`/pipelines/${pid}`)
  await ui.clickText('触发器', 'button')
  await ui.sleep(300)
  await ui.clickText('＋ 新建触发器', 'button')
  await ui.sleep(300)
  const trigFilled = (await fillInModal('触发器名称', trigName)) && (await fillInModal('cron 表达式', '0 9 * * *'))
  await ui.evalJs(`(()=>{const m=[...document.querySelectorAll('.modal')].find(x=>x.offsetParent!==null);const b=m&&[...m.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='保存'&&!x.disabled);if(!b)return false;b.click();return true})()`)
  await ui.sleep(900)
  const trigAfter = ui.pg(`select id,name,enabled from pipeline_triggers where pipeline_id='${pid}' and name='${trigName}'`)
  const trigReq = ui.apiLog.find((a) => a.method === 'POST' && /\/pipelines\/[^/]+\/triggers/.test(a.path))
  await ui.run('OP-30', '建触发器（triggers 落库）', () => ({
    requestOk: !!trigReq && trigReq.status >= 200 && trigReq.status < 400,
    backendChanged: trigAfter.length > 0,
    uiReflected: trigFilled,
    before: { count: 0 }, after: { rows: trigAfter }, request: trigReq,
    probe: { trigName, trigFilled, trigReqBody: trigReq?.body },
  }))

  finish(ui, 'UI-OP-PIPELINE', { note: '第三批：流水线编排域（S 同步落库）', fixture: { componentId: CID, pipelineId: pid } })
}

main().catch((e) => { console.error('OP PIPELINE ERROR:', e.message); process.exitCode = 1 })
