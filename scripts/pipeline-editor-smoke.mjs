// 流水线全生命周期（C-12）契约冒烟。
// 跑法：pnpm test:pipeline（或 node scripts/pipeline-editor-smoke.mjs）。
//
// 与 runcenter / theme-and-search 两个冒烟同一手法：直接 import 源码 .ts
// （Node ≥22.18 原生类型剥离），测出厂代码本身；涉及 DOM 的部分改为**静态断言**
// 源码里的关键不变量，防止契约回退。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildPipelineRequest,
  changeClass,
  changeLabel,
  circled,
  deriveTaskType,
  diffRows,
  executionModeLabel,
  expandPipelineCalls,
  fieldLabel,
  identicalMark,
  isDeleteConfirmed,
  isNoopRollback,
  isStageExecutionMode,
  moveChanged,
  moveItem,
  natureFromTaskType,
  nextExecutionMode,
  objToYaml,
  pickLatestRuns,
  readDeleteVerdict,
  rollbackWarning,
  runPhaseClass,
  runPhaseLabel,
  showFieldValue,
  summarizeDiff,
  taskNature,
  taskTypeClass,
  taskTypeIcon,
  versionLabel,
  versionOrigin,
  yamlScalar,
} from '../src/utils/pipeline.ts'

let pass = 0
const cases = []
function check(name, fn) {
  try {
    fn()
    cases.push(`  ✓ ${name}`)
    pass++
  } catch (e) {
    cases.push(`  ✗ ${name}\n      ${e.message}`)
  }
}
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

// ===========================================================================
// 一、子任务类型派生（§7.4 / 附 D.3 —— 不露原词，由配置派生）
// ===========================================================================

check('派生优先级：发布配置 > 审批人 > 构建（与原型 deriveType 一致）', () => {
  assert.equal(deriveTaskType({}), 'Build')
  assert.equal(deriveTaskType({ approvers: 'alice' }), 'Approval')
  assert.equal(deriveTaskType({ hasReleaseConfig: true }), 'Release')
  // 两组都填时 Release 优先
  assert.equal(deriveTaskType({ hasReleaseConfig: true, approvers: 'alice' }), 'Release')
  assert.equal(deriveTaskType({ releaseTarget: 'prod' }), 'Release')
  assert.equal(deriveTaskType({ rollout: '10%' }), 'Release')
})

check('纯空白不算"填了"（原型用真值判断，空格串会被误判为 Release）', () => {
  assert.equal(deriveTaskType({ approvers: '   ' }), 'Build')
  assert.equal(deriveTaskType({ approvers: '\t\n' }), 'Build')
  assert.equal(deriveTaskType({ releaseTarget: ' ' }), 'Build')
  assert.equal(deriveTaskType({ approvers: ' alice ' }), 'Approval')
})

check('派生只认 true，不认 truthy（hasReleaseConfig: 1 不算）', () => {
  assert.equal(deriveTaskType({ hasReleaseConfig: true }), 'Release')
  assert.equal(deriveTaskType({ hasReleaseConfig: false }), 'Build')
  assert.equal(deriveTaskType({ hasReleaseConfig: undefined }), 'Build')
})

check('产品语言三态固定，且**不含**三态原词', () => {
  assert.equal(taskNature({}), '构建 / 运行任务')
  assert.equal(taskNature({ approvers: 'a' }), '人工审核阶段')
  assert.equal(taskNature({ hasReleaseConfig: true }), '发布任务')
  for (const s of [taskNature({}), taskNature({ approvers: 'a' }), taskNature({ hasReleaseConfig: true })]) {
    assert.ok(!/Build|Release|Approval/.test(s), `产品语言不应出现原词：${s}`)
  }
})

check('由已落库 type 反查的产品语言与派生侧措辞一致（两处不得漂移）', () => {
  assert.equal(natureFromTaskType('Build'), taskNature({}))
  assert.equal(natureFromTaskType('Release'), taskNature({ hasReleaseConfig: true }))
  assert.equal(natureFromTaskType('Approval'), taskNature({ approvers: 'x' }))
})

check('任务卡图标 / 样式类三态互不相同', () => {
  assert.equal(taskTypeIcon('Build'), '⌘')
  assert.equal(taskTypeIcon('Release'), '⬇')
  assert.equal(taskTypeIcon('Approval'), '✓')
  assert.equal(taskTypeClass('Build'), 'ti-build')
  assert.equal(taskTypeClass('Release'), 'ti-release')
  assert.equal(taskTypeClass('Approval'), 'ti-approval')
})

// ===========================================================================
// 二、executionMode + 重排
// ===========================================================================

check('executionMode 只认 parallel/serial，空串与老数据不可信', () => {
  assert.equal(isStageExecutionMode('parallel'), true)
  assert.equal(isStageExecutionMode('serial'), true)
  assert.equal(isStageExecutionMode('Parallel'), false, '大小写敏感（契约一律小写）')
  assert.equal(isStageExecutionMode(''), false)
  assert.equal(isStageExecutionMode(undefined), false)
  assert.equal(isStageExecutionMode(null), false)
})

check('模式切换是二态往返，且标签与 hub 取值对应', () => {
  assert.equal(nextExecutionMode('parallel'), 'serial')
  assert.equal(nextExecutionMode('serial'), 'parallel')
  assert.equal(nextExecutionMode(nextExecutionMode('parallel')), 'parallel')
  assert.equal(executionModeLabel('parallel'), '并行')
  assert.equal(executionModeLabel('serial'), '串行')
})

check('moveItem 返回新数组、不改原数组', () => {
  const a = ['x', 'y', 'z']
  const b = moveItem(a, 1, 'up')
  assert.deepEqual(b, ['y', 'x', 'z'])
  assert.deepEqual(a, ['x', 'y', 'z'], '原数组必须保持不变')
  assert.deepEqual(moveItem(a, 1, 'down'), ['x', 'z', 'y'])
})

check('越界重排原地不动（并据此决定是否标脏）', () => {
  assert.deepEqual(moveItem(['x', 'y'], 0, 'up'), ['x', 'y'])
  assert.deepEqual(moveItem(['x', 'y'], 1, 'down'), ['x', 'y'])
  assert.equal(moveChanged(['x', 'y'], 0, 'up'), false, '已在首位 → 不动')
  assert.equal(moveChanged(['x', 'y'], 1, 'down'), false, '已在末位 → 不动')
  assert.equal(moveChanged(['x', 'y'], 0, 'down'), true)
  assert.equal(moveChanged(['x', 'y'], 1, 'up'), true)
  assert.equal(moveChanged([], 0, 'down'), false)
})

check('阶段序号前缀（①②③…，超出用数字兜底）', () => {
  assert.equal(circled(0), '①')
  assert.equal(circled(9), '⑩')
  assert.equal(circled(10), '11.')
})

// ===========================================================================
// 三、请求体构造 + JSON / YAML 双视图（附 D.4）
// ===========================================================================

const BODY = {
  componentId: 'comp-1',
  name: '日常流水线',
  kind: 'build',
  stages: [
    {
      name: '构建',
      sequence: 1,
      executionMode: 'parallel',
      tasks: [
        { type: 'Build', name: 'go build', displayOrder: 1, image: 'golang:1.27', command: ['go'], args: ['build', './...'] },
      ],
    },
  ],
}

check('端点：有 id 走 PUT、无 id 走 POST（§7.4 请求体预览要标注它）', () => {
  const put = buildPipelineRequest('pid-1', BODY)
  assert.equal(put.method, 'PUT')
  assert.equal(put.url, '/api/v1/pipelines/pid-1')
  const post = buildPipelineRequest(undefined, BODY)
  assert.equal(post.method, 'POST')
  assert.equal(post.url, '/api/v1/pipelines')
})

check('展开序列与 [保存] 的实现一一对应（元信息 → N 个阶段 → 子任务重排）', () => {
  const calls = expandPipelineCalls('pid-1', BODY, ['st-1'])
  assert.ok(calls[0].startsWith('PUT    /api/v1/pipelines/pid-1'), `首行应为元信息 PUT，实际 ${calls[0]}`)
  assert.ok(calls[1].includes('/api/v1/stages/st-1'), '第二行应为阶段 PUT')
  assert.ok(calls[1].includes('executionMode=parallel'), '阶段行须带 executionMode')
  assert.ok(calls[2].includes('× 1'), `子任务行须带条数，实际 ${calls[2]}`)
  assert.equal(calls.length, 3)
})

check('展开序列：空阶段不产生子任务行（不留空占位）', () => {
  const body = { ...BODY, stages: [{ name: '空阶段', sequence: 1, executionMode: 'serial', tasks: [] }] }
  const calls = expandPipelineCalls('pid-1', body, ['st-9'])
  assert.equal(calls.length, 2)
  assert.ok(calls[1].includes('executionMode=serial'))
})

check('YAML 标量：需要引号的一律引号化（防被解析成别的类型）', () => {
  assert.equal(yamlScalar('golang:1.27'), '"golang:1.27"')
  assert.equal(yamlScalar('build'), 'build')
  assert.equal(yamlScalar(''), '""')
  assert.equal(yamlScalar(600), '600')
  assert.equal(yamlScalar(true), 'true')
  assert.equal(yamlScalar('a b'), '"a b"')
})

check('objToYaml：数组项带 "- " 前缀，undefined/null 键被跳过', () => {
  const y = objToYaml({ name: 'p', kind: 'build', description: undefined, stages: [{ name: 's1' }] })
  assert.ok(y.includes('name: p\n'), `实际：\n${y}`)
  assert.ok(!y.includes('description'), 'undefined 不应出现在 YAML 里')
  assert.ok(y.includes('- name: s1'), `数组项应带 "- " 前缀，实际：\n${y}`)
})

check('objToYaml：空数组 / 空对象有明确表示（不是静默空白）', () => {
  assert.equal(objToYaml([]).trim(), '[]')
  assert.equal(objToYaml({}).trim(), '{}')
})

// ===========================================================================
// 四、删除 verdict（§7.4：前端零判断，只渲染后端 409 + {reasons}）
// ===========================================================================

check('409 + reasons → 阻断，reasons 原样透传（不加工、不排序）', () => {
  const v = readDeleteVerdict(409, {
    error: 'pipeline still has in-progress runs',
    errorCode: 'ERR.xxxx',
    reasons: ['2 条运行仍在进行中（Pending/Running/WaitingApproval），请先终止后再删除'],
  })
  assert.equal(v.blocked, true)
  assert.deepEqual(v.reasons, ['2 条运行仍在进行中（Pending/Running/WaitingApproval），请先终止后再删除'])
  assert.equal(v.message, 'pipeline still has in-progress runs')
})

check('reasons 保持后端给的顺序（前端不得重排）', () => {
  const v = readDeleteVerdict(409, { reasons: ['第二条', '第一条'] })
  assert.deepEqual(v.reasons, ['第二条', '第一条'])
})

check('409 无 reasons 仍算阻断（不能因为文案缺失就放行）', () => {
  assert.equal(readDeleteVerdict(409, {}).blocked, true)
  assert.deepEqual(readDeleteVerdict(409, {}).reasons, [])
  assert.equal(readDeleteVerdict(409, {}).message, '删除失败')
})

check('非 409 且无 reasons → 非阻断（真失败走 toast，不开"无法删除"弹窗）', () => {
  assert.equal(readDeleteVerdict(500, { error: 'boom' }).blocked, false)
  assert.equal(readDeleteVerdict(undefined, undefined).blocked, false)
  assert.equal(readDeleteVerdict(500, { error: 'boom' }).message, 'boom')
})

check('reasons 里的空白项被丢弃（避免渲染空 li）', () => {
  const v = readDeleteVerdict(409, { reasons: ['  ', '', '有效理由'] })
  assert.deepEqual(v.reasons, ['有效理由'])
})

check('强确认必须与名称完全一致（trim 后），空输入永远不放行', () => {
  assert.equal(isDeleteConfirmed('日常流水线', '日常流水线'), true)
  assert.equal(isDeleteConfirmed('  日常流水线  ', '日常流水线'), true)
  assert.equal(isDeleteConfirmed('日常流水', '日常流水线'), false)
  assert.equal(isDeleteConfirmed('日常流水线A', '日常流水线'), false)
  assert.equal(isDeleteConfirmed('', '日常流水线'), false)
  assert.equal(isDeleteConfirmed('   ', '日常流水线'), false)
})

// ===========================================================================
// 五、「最近运行」列
// ===========================================================================

check('pickLatestRuns：按 createdAt 取最新一条，且不混入别的流水线', () => {
  const runs = [
    { pipelineId: 'p1', phase: 'Failed', createdAt: '2026-09-20T10:00:00Z' },
    { pipelineId: 'p1', phase: 'Succeeded', createdAt: '2026-09-22T10:00:00Z' },
    { pipelineId: 'p2', phase: 'Running', createdAt: '2026-09-21T10:00:00Z' },
  ]
  const m = pickLatestRuns(runs)
  assert.equal(m.p1.phase, 'Succeeded', '应取 createdAt 最新的那条')
  assert.equal(m.p2.phase, 'Running')
  assert.equal(Object.keys(m).length, 2)
})

check('pickLatestRuns：空输入返回空表（列表照常渲染 "—"）', () => {
  assert.deepEqual(pickLatestRuns([]), {})
})

check('相位 → 产品语言 / 徽章类（复用全局 .b-* ，不自造类名）', () => {
  assert.equal(runPhaseLabel('Succeeded'), '成功')
  assert.equal(runPhaseLabel('Failed'), '失败')
  assert.equal(runPhaseLabel('Running'), '运行中')
  assert.equal(runPhaseLabel('WaitingApproval'), '待审批')
  assert.equal(runPhaseLabel('Pending'), '排队中')
  assert.equal(runPhaseLabel('Cancelled'), '已取消')
  assert.equal(runPhaseClass('Succeeded'), 'b-succ')
  assert.equal(runPhaseClass('Failed'), 'b-fail')
  assert.equal(runPhaseClass('Running'), 'b-run')
  assert.equal(runPhaseClass('WaitingApproval'), 'b-warn')
  assert.equal(runPhaseClass('Pending'), 'b-pend')
})

check('未知相位不崩、按中性灰处理（后端新增相位时不至于白屏）', () => {
  assert.equal(runPhaseLabel('SomethingNew'), 'SomethingNew')
  assert.equal(runPhaseLabel(''), '—')
  assert.equal(runPhaseClass('SomethingNew'), 'b-pend')
})

// ===========================================================================
// 六、静态不变量（防契约回退）
// ===========================================================================

check('TaskFormDrawer：模板里**不露**三态原词（§7.4 拍板）', () => {
  const src = read('../src/components/TaskFormDrawer.vue')
  const tpl = src.slice(src.indexOf('<template>'), src.indexOf('</template>'))
  for (const word of ['Build', 'Release', 'Approval']) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(tpl), `表单模板仍出现原词 ${word}`)
  }
  assert.ok(src.includes('由填写内容自动识别，非类别选择'), '缺少"非类别选择"的说明文案')
  assert.ok(src.includes('taskNature'), '表单未使用派生出的产品语言')
})

check('TaskFormDrawer：不再有三选一的 mode 单选控件', () => {
  const src = read('../src/components/TaskFormDrawer.vue')
  assert.ok(!src.includes('mode-row'), '不应再有 mode 三选一控件')
  assert.ok(!src.includes("form.type ="), '不应再手动设置 type —— 必须由配置派生')
})

check('PipelinesTab：已去掉"仅支持 build"的过时客户端闸门（N-7）', () => {
  const src = read('../src/views/component/tabs/PipelinesTab.vue')
  assert.ok(!src.includes('仅支持编排 build'), '仍存在 kind 客户端闸门')
  assert.ok(!/p\.kind\s*!==\s*'build'/.test(src), '仍按 kind 拦截编辑')
})

check('PipelinesTab：列出 §7.4 要求的五列 + 新建入口', () => {
  const src = read('../src/views/component/tabs/PipelinesTab.vue')
  for (const col of ['名称', '类型', '版本', '最近运行']) {
    assert.ok(src.includes(col), `缺少列「${col}」`)
  }
  assert.ok(src.includes('＋ 新建流水线'), '缺少新建入口')
  assert.ok(src.includes('删除流水线'), '缺少删除入口')
})

check('PipelinesTab：最近运行走一次 componentId 过滤，不开 N+1', () => {
  const src = read('../src/views/component/tabs/PipelinesTab.vue')
  assert.ok(src.includes('componentId: props.componentId'), '未按 componentId 过滤运行')
  assert.ok(!src.includes('listByPipeline('), '不应逐条流水线各拉一次运行列表')
})

check('删除是「强确认 → DELETE → 渲染 verdict」，前端不预计算影响面', () => {
  const src = read('../src/views/component/tabs/PipelinesTab.vue')
  assert.ok(src.includes('isDeleteConfirmed'), '缺少强确认校验')
  assert.ok(src.includes('readDeleteVerdict'), '未渲染后端 verdict')
  assert.ok(src.includes('reasons'), '未渲染 reasons')
})

check('编辑器：单条直取 GET /pipelines/:id，不再用 componentId query 反查', () => {
  const src = read('../src/views/PipelineEditorView.vue')
  assert.ok(src.includes('pipelineApi.get(pipelineId)'), '未直取单条流水线')
  assert.ok(!src.includes('route.query.componentId'), '仍残留 componentId query hack')
  // 过时注释也一并清掉，免得下一个人照着它继续绕路
  assert.ok(!src.includes('无单查端点'), '仍残留"pipeline 无单查端点"的过时结论')
})

check('编辑器：[保存] 先弹预览再发送，且预览同时给出实际调用序列', () => {
  const src = read('../src/views/PipelineEditorView.vue')
  assert.ok(src.includes('expandPipelineCalls'), '预览未标注实际调用序列（会误导用户）')
  assert.ok(src.includes('previewCalls'), '未渲染调用序列')
  assert.ok(src.includes('确认保存'), '缺少确认发送动作')
})

check('编辑器：阶段增删 + 子任务删除 + 顺序落库都是即时调用', () => {
  const src = read('../src/views/PipelineEditorView.vue')
  for (const call of [
    'pipelineApi.createStage',
    'pipelineApi.deleteStage',
    'pipelineApi.deleteTask',
    'pipelineApi.updateTask',
  ]) {
    assert.ok(src.includes(call), `缺少即时落库调用 ${call}`)
  }
})

check('子任务的建 / 改在 TaskFormDrawer（编辑器只负责顺序与模式）', () => {
  const drawer = read('../src/components/TaskFormDrawer.vue')
  assert.ok(drawer.includes('pipelineApi.createTask'), '表单缺少新建调用')
  assert.ok(drawer.includes('pipelineApi.updateTask'), '表单缺少更新调用')
})

check('阶段头 executionMode 开关确实落库（不是装饰控件）', () => {
  const src = read('../src/views/PipelineEditorView.vue')
  assert.ok(src.includes('toggleMode'), '缺少模式切换')
  assert.ok(src.includes('updateStage'), '模式切换未落库 —— 会变成刷新即失效的装饰控件')
})

check('预览面板如实标注「hub 无整 DAG 端点」这一落差（附 D.4）', () => {
  const src = read('../src/views/PipelineEditorView.vue')
  assert.ok(src.includes('整 DAG 一次提交'), '未如实标注 hub 无整 DAG 端点')
})

check('api/pipeline.ts：executionMode 已进类型，updateStage 已存在', () => {
  const src = read('../src/api/pipeline.ts')
  assert.ok(src.includes('executionMode: StageExecutionMode'), 'PipelineStage 缺 executionMode')
  assert.ok(src.includes('updateStage'), '缺少 updateStage')
})

check('pipelines 的 kind 未被当成可编排范围闸门（三种取值都可编排）', () => {
  const src = read('../src/views/component/tabs/PipelinesTab.vue')
  for (const k of ['build', 'release', 'custom']) {
    assert.ok(src.includes(k), `kind 选项缺 ${k}`)
  }
})

// ===========================================================================
// 七、版本历史 / 对比 / 回滚（C-09）
//    判定"改没改"完全在 hub（models.DiffSnapshots）；这一节只测**呈现规则**，
//    以及"前端没有偷偷自己比一遍"这条不变量。
// ===========================================================================

const DIFF = {
  stages: [
    { name: '构建', change: 'modified', fields: [{ field: 'executionMode', from: 'parallel', to: 'serial' }] },
    { name: '发布', change: 'added', fields: [] },
  ],
  tasks: [
    { stage: '构建', name: 'go build', change: 'removed', fields: [] },
    { stage: '构建', name: 'go test', change: 'added', fields: [{ field: 'image', from: '', to: 'golang:1.27' }] },
  ],
}

check('versionLabel：只有当前版带「当前」标注', () => {
  assert.equal(versionLabel(3, true), 'v3（当前）')
  assert.equal(versionLabel(2, false), 'v2')
})

check('changeLabel：三态各有产品语言', () => {
  assert.equal(changeLabel('added'), '新增')
  assert.equal(changeLabel('removed'), '移除')
  assert.equal(changeLabel('modified'), '修改')
})

check('changeClass 复用 tokens.css 里已存在的 .b-* （不引用未定义类名）', () => {
  const css = read('../src/styles/tokens.css')
  assert.equal(changeClass('added'), 'b-succ')
  assert.equal(changeClass('removed'), 'b-fail')
  assert.equal(changeClass('modified'), 'b-warn')
  for (const c of ['b-succ', 'b-fail', 'b-warn']) {
    assert.ok(css.includes(`.${c}`), `tokens.css 未定义 .${c} —— 状态色会静默失效`)
  }
})

check('fieldLabel：认识的字段翻成产品语言', () => {
  assert.equal(fieldLabel('executionMode'), '执行模式')
  assert.equal(fieldLabel('image'), '镜像')
  assert.equal(fieldLabel('displayOrder'), '子任务顺序')
  assert.equal(fieldLabel('approvalConfig'), '审批配置')
})

check('fieldLabel：未知字段**原样返回**（宁可露出字段名，也不静默吞掉一处改动）', () => {
  assert.equal(fieldLabel('rolloutConfig'), '灰度配置', '已知字段照常翻译')
  assert.equal(fieldLabel('someFutureField'), 'someFutureField')
  assert.equal(fieldLabel(''), '')
})

check('showFieldValue：空值给显式占位，不留白', () => {
  assert.equal(showFieldValue(''), '（空）')
  assert.equal(showFieldValue('null'), '（未设置）')
  assert.equal(showFieldValue('parallel'), 'parallel')
})

check('versionOrigin：有作者时「作者 · 时间」，无作者时只说时间', () => {
  assert.equal(versionOrigin('alice', '2026-09-22T10:30:00Z'), 'alice · 2026-09-22 10:30:00')
  assert.equal(versionOrigin('', '2026-09-22T10:30:00Z'), '2026-09-22 10:30:00')
  assert.equal(versionOrigin(undefined, '2026-09-22T10:30:00Z'), '2026-09-22 10:30:00')
  assert.equal(versionOrigin('  ', '2026-09-22T10:30:00Z'), '2026-09-22 10:30:00')
})

check('identicalMark：**未知**不能与「无差异」混为一谈', () => {
  assert.equal(identicalMark(undefined), '', '未知（上一版不在窗口内）不得标"无差异"')
  assert.equal(identicalMark(false), '')
  assert.equal(identicalMark(true), '与前版无差异')
})

check('summarizeDiff：全空显式说「完全相同」，而不是留空行', () => {
  const zero = {
    stagesAdded: 0, stagesRemoved: 0, stagesModified: 0,
    tasksAdded: 0, tasksRemoved: 0, tasksModified: 0,
  }
  assert.equal(summarizeDiff(zero), '两份定义完全相同')
})

check('summarizeDiff：只列出非零项（不出现 "0 新增" 这种噪音）', () => {
  const s = summarizeDiff({
    stagesAdded: 1, stagesRemoved: 0, stagesModified: 0,
    tasksAdded: 1, tasksRemoved: 1, tasksModified: 0,
  })
  assert.equal(s, '阶段：1 新增 · 子任务：1 新增 / 1 移除')
  assert.ok(!s.includes('0 '), `不应出现零计数：${s}`)
})

check('diffRows：阶段在前、子任务在后，且顺序**照抄后端**（前端不重排）', () => {
  const rows = diffRows(DIFF)
  assert.deepEqual(
    rows.map((r) => [r.kind, r.name]),
    [['stage', '构建'], ['stage', '发布'], ['task', 'go build'], ['task', 'go test']],
  )
  // 后端已按名称稳定排序；前端再排一次会让同一份 diff 在两处呈现不同顺序
  const src = read('../src/utils/pipeline.ts')
  assert.ok(!/diffRows[\s\S]{0,600}?\.sort\(/.test(src), 'diffRows 不得自己再排序一遍')
})

check('diffRows：字段差异预先翻成产品语言 + 值占位', () => {
  const rows = diffRows(DIFF)
  const build = rows[0]
  assert.equal(build.fields.length, 1)
  assert.equal(build.fields[0].label, '执行模式')
  assert.equal(build.fields[0].from, 'parallel')
  assert.equal(build.fields[0].to, 'serial')
  const test = rows[3]
  assert.equal(test.fields[0].label, '镜像')
  assert.equal(test.fields[0].from, '（空）')
  assert.equal(test.fields[0].to, 'golang:1.27')
})

check('diffRows：无字段差异的行留空数组（由视图渲染「结构位置变化」）', () => {
  const rows = diffRows(DIFF)
  assert.deepEqual(rows[1].fields, [])
  assert.equal(rows[2].stage, '构建', '子任务行须带所属阶段')
  assert.equal(rows[0].stage, undefined, '阶段行不带 stage')
})

check('diffRows：缺字段 / 缺数组都不崩（后端窗口边界）', () => {
  assert.deepEqual(diffRows({ stages: [], tasks: [] }), [])
  assert.deepEqual(diffRows({ stages: [{ name: 'x', change: 'added' }], tasks: [] })[0].fields, [])
})

check('isNoopRollback：目标 = 当前版 → 无操作（按钮置灰，避免白记一版）', () => {
  assert.equal(isNoopRollback(5, 5), true)
  assert.equal(isNoopRollback(4, 5), false)
})

check('回滚文案不露 Markdown 标记，且说明「结构替换 + 追加历史」', () => {
  const w = rollbackWarning(2)
  assert.ok(!w.includes('**'), `文案会被 {{ }} 直接渲染，星号会原样露给用户：${w}`)
  assert.ok(w.includes('v2'))
  assert.ok(w.includes('名称 / 类型 / 描述不受影响'), '未说清元信息不受影响 —— 用户会以为改名被还原')
  assert.ok(w.includes('旧版本不会被删除'), '未说清历史是追加的')
})

check('api/pipeline.ts：四个版本端点与 hub 路由逐字对齐', () => {
  const src = read('../src/api/pipeline.ts')
  assert.ok(src.includes('/pipelines/${pipelineId}/versions'), '缺列表端点')
  assert.ok(src.includes('getVersion'), '缺单版端点')
  // 方向性：hub 是 `.../versions/:version/diff?against=<基准>`（基准在查询串里）
  assert.ok(src.includes('/versions/${version}/diff'), 'diff 未挂在 :version 之下')
  assert.ok(src.includes('params: { against }'), 'diff 的基准参数名必须是 against（与 hub 一致）')
  assert.ok(src.includes('/versions/${version}/rollback'), '缺回滚端点')
  assert.ok(src.includes('rollbackVersion'), '缺回滚调用')
})

check('版本面板：判定全走后端 diff，前端不自己比快照', () => {
  const src = read('../src/components/PipelineVersionPanel.vue')
  for (const fn of ['diffRows', 'summarizeDiff', 'changeClass', 'isNoopRollback', 'rollbackWarning']) {
    assert.ok(src.includes(fn), `面板未使用 ${fn}`)
  }
  assert.ok(src.includes('pipelineApi.diffVersions'), '对比未调用后端 diff 端点')
  assert.ok(!src.includes('JSON.stringify'), '面板不应自己序列化比快照 —— 两份 diff 实现必然漂移')
})

check('版本面板：回滚是破坏性操作 —— 二次确认 + 危险按钮', () => {
  const src = read('../src/components/PipelineVersionPanel.vue')
  assert.ok(src.includes('确认回滚'), '缺少二次确认动作')
  assert.ok(src.includes('btn-danger'), '回滚确认按钮应用危险样式')
  assert.ok(src.includes('回滚到此版'), '缺少回滚入口')
})

check('编辑器：版本入口已接上，并在回滚后重载流水线', () => {
  const src = read('../src/views/PipelineEditorView.vue')
  assert.ok(src.includes('PipelineVersionPanel'), '编辑器未挂载版本面板')
  assert.ok(src.includes('版本历史'), '缺少版本历史入口')
  assert.ok(src.includes('@rolled-back'), '回滚后未重载流水线（界面会停在旧版本号）')
})

// ===========================================================================
// 八、触发拒绝的结构化呈现（B-11：生产强审批 409 + reasons）
// ===========================================================================

check('触发对话框：策略拒绝**留在对话框里**，不只发一句 toast', () => {
  const src = read('../src/components/TriggerRunDialog.vue')
  assert.ok(src.includes('readDeleteVerdict'), '未复用统一的 409 + {reasons} 读取逻辑')
  assert.ok(src.includes('refusal'), '未保留拒绝状态（用户看不到"为什么不能触发"）')
  assert.ok(src.includes('refusal.reasons'), '未逐条渲染后端理由')
})

check('触发对话框：.refusal 有样式定义（引用未定义类名 = 静默无样式）', () => {
  const src = read('../src/components/TriggerRunDialog.vue')
  assert.ok(src.includes('class="refusal"'), '模板未使用 .refusal')
  assert.ok(/<style[^>]*>[\s\S]*?\.refusal\s*\{/.test(src), '.refusal 无样式定义')
  assert.ok(src.includes('var(--warning-bg)'), '策略拒绝应用 warning 语义色（不是 failed）')
})

console.log(cases.join('\n'))
console.log(`\n${pass}/${cases.length} passed`)
process.exit(pass === cases.length ? 0 : 1)
