// console UI 验证判据契约：计划全部 38 条用例的断言从权威规范正向推导。
// 契约是判据的唯一来源（SSOT）；执行脚本只产出观测事实，判定由 contract-runner.mjs 收口。
// 规范引用精确到文件与章节，判据变更即评审变更。
export const SPEC = {
  fiveStates: 'software-distribution-platform-docs/console/features/CONSOLE-FRONTEND-FIVES-STATES-2026-10-11.md',
  ui05: 'software-distribution-platform-docs/console/features/ui-05-page-layouts.md',
  ui08: 'software-distribution-platform-docs/console/features/ui-08-testing-acceptance.md',
  ui04: 'software-distribution-platform-docs/console/features/ui-04-pipeline-modes.md',
  plan: 'software-distribution-platform-docs/plans/console-ui-verification-testcases.md',
}

// 证据类型（白名单，杜绝否定式判据）：
//   text  DOM 文本包含 value
//   url   落地 URL 包含 value
//   api   apiCalls 中存在 path 含 value 且 status 符合要求（默认 2xx）
//   flag  flags[name] === true
//   count counts[name] >= value
//   field meta[name] === value，或 meta[name] !== notValue
//   shaRef meta.sha256 === meta.referenceSha256
// positive 必须全部命中；forbidden 必须全部不命中。
//
// 每条契约字段：suite / spec / target / positive / forbidden / precondition / knownGap / artifact
export const CRITERIA = {
  // ---------- UI-B 行为交互（12）----------
  'UI-B01': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B01`, target: '全部顶层与组件子路由可达、DOM 非空、每页至少一个成功 API、无未捕获 JS 异常',
    positive: [{ kind: 'flag', name: 'routeReached' }, { kind: 'flag', name: 'apiPresent' }, { kind: 'flag', name: 'noJsError' }],
  },
  'UI-B02': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B02`, target: '⌘K 打开搜索浮层，输入后命中目标组件并可直达',
    positive: [{ kind: 'flag', name: 'paletteOpened' }, { kind: 'text', value: 'gateway' }, { kind: 'flag', name: 'navigated' }],
  },
  'UI-B03': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B03`, target: '服务树按层懒加载，展开才发下一层请求，虚拟滚动窗口索引连续',
    positive: [{ kind: 'flag', name: 'lazyLoaded' }, { kind: 'flag', name: 'windowScrolled' }],
    // 本地 fixture 服务树只有一层且首屏已加载，展开不产生下一层请求；按层懒加载待多层数据后展开。
    knownGap: true,
  },
  'UI-B04': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B04`, target: '运行中心状态筛选与分页真实生效，两视图可切',
    positive: [{ kind: 'flag', name: 'viewSwitched' }, { kind: 'flag', name: 'filterApplied' }, { kind: 'flag', name: 'pageTwo' }],
  },
  'UI-B05': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B05`, target: '深链五子情形：发布视图分页、裸链归一、返回一次、两条旧链重定向',
    positive: [
      { kind: 'flag', name: 'deepLinkRelease' }, { kind: 'flag', name: 'normalizeRuns' },
      { kind: 'flag', name: 'backOnce' }, { kind: 'flag', name: 'legacyReleases' }, { kind: 'flag', name: 'legacyPipelines' },
    ],
  },
  'UI-B06': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B06`, target: '组件详情 11 个 Tab 全部可切换且 URL 同步',
    positive: [{ kind: 'flag', name: 'allTabsReached' }, { kind: 'count', name: 'tabs', value: 11 }],
  },
  'UI-B07': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B07 / ${SPEC.ui04} §6.1 D1`, target: '流水线 UI 新建/改名/删除，409 verdict 原样渲染',
    positive: [{ kind: 'flag', name: 'created' }, { kind: 'flag', name: 'renamed' }, { kind: 'flag', name: 'deleteConfirmed' }, { kind: 'flag', name: 'verdictRendered' }],
  },
  'UI-B08': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B08`, target: '总览待办卡深链到对应视图且筛选真实生效',
    positive: [{ kind: 'flag', name: 'cardDeepLink' }, { kind: 'flag', name: 'filterEffective' }],
  },
  'UI-B09': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B09`, target: '灰度发布 pause / promote / rollback 三动作均发真实请求并推进状态',
    positive: [{ kind: 'flag', name: 'paused' }, { kind: 'flag', name: 'promoted' }, { kind: 'flag', name: 'rolledBack' }],
  },
  'UI-B10': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B10`, target: '运行监控审批弹窗可填意见并提交，阶段状态更新',
    positive: [{ kind: 'flag', name: 'dialogOpened' }, { kind: 'flag', name: 'decisionSent' }, { kind: 'flag', name: 'stageUpdated' }],
  },
  'UI-B11': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B11`, target: 'Modal/Drawer/HighRiskConfirm/TriggerRunDialog 四态可循环且 DOM 无残留',
    positive: [{ kind: 'flag', name: 'reopenedClean' }, { kind: 'count', name: 'components', value: 4 }],
  },
  'UI-B12': {
    suite: 'UI-B', spec: `${SPEC.plan} §三 UI-B12`, target: '双主题与灰阶切换后图标形状可辨、文字对比度达标',
    positive: [{ kind: 'flag', name: 'themeToggled' }, { kind: 'flag', name: 'grayToggled' }, { kind: 'flag', name: 'contrastOk' }],
  },

  // ---------- UI-S 五态与异常态（10，S00 为映射表附件）----------
  'UI-S00': {
    suite: 'UI-S', artifact: true, spec: `${SPEC.plan} §四 UI-S00 / ${SPEC.fiveStates} §2`,
    target: '16 组视图的四态 + 无权限态均有可执行触发方式，截图与用例一一映射',
    positive: [{ kind: 'flag', name: 'mappingComplete' }, { kind: 'count', name: 'views', value: 16 }],
  },
  'UI-S01': {
    suite: 'UI-S', spec: `${SPEC.fiveStates} §1 加载态`, target: '首次请求期间呈现加载中，成功后消失',
    positive: [{ kind: 'flag', name: 'sawLoading' }], precondition: 'injected',
  },
  'UI-S02': {
    suite: 'UI-S', spec: `${SPEC.fiveStates} §1 空态`, target: '200 且数据为空时呈现空态文案与引导动作',
    positive: [{ kind: 'text', value: '暂无运行记录' }], precondition: 'injected',
  },
  'UI-S03': {
    suite: 'UI-S', spec: `${SPEC.fiveStates} §1 错误态 + ${SPEC.ui05} §7.9「不伪装成无用户」`,
    target: 'API 500 时呈现错误摘要与重试入口，不回落为空态',
    positive: [{ kind: 'text', value: '加载失败' }, { kind: 'text', value: '重试' }],
    forbidden: [{ kind: 'text', value: '暂无运行记录' }, { kind: 'text', value: 'injected 500' }], precondition: 'injected',
  },
  'UI-S04': {
    suite: 'UI-S', spec: `${SPEC.fiveStates} §1 成功态`, target: '正常响应下数据渲染行数与响应条数一致，徽章枚举符合契约',
    positive: [{ kind: 'flag', name: 'rowsMatchApi' }, { kind: 'flag', name: 'badgesConform' }],
  },
  'UI-S05': {
    suite: 'UI-S', spec: `${SPEC.ui05} §7.9「API 403 → §8.2 错误态：操作被拒绝，请申请…」`,
    target: 'API 403 时就地呈现拒绝原因与申请引导，不全局跳页、不暴露原始错误体',
    positive: [{ kind: 'text', value: '操作被拒绝' }, { kind: 'text', value: '申请' }],
    forbidden: [{ kind: 'text', value: 'insufficient permission' }, { kind: 'url', value: '/forbidden' }], precondition: 'injected',
  },
  'UI-S06': {
    suite: 'UI-S', spec: `${SPEC.fiveStates} §3 403 三策略`, target: '隐藏与可点后拦截两种已实现策略各有正向证据',
    positive: [{ kind: 'flag', name: 'hiddenStrategy' }, { kind: 'flag', name: 'interceptStrategy' }],
    // 「禁用+tooltip 权限策略」前端无实现（现有 disabled 全是业务态、非权限态），转缺陷清单；
    // 契约只断言真实存在的两策略，不以缺失项制造必然 FAIL，也不把它记作通过。
  },
  'UI-S07': {
    suite: 'UI-S', spec: `${SPEC.fiveStates} §3.2 权限判定顺序`, target: '无权限用户不发列表请求，有权限用户发请求',
    positive: [{ kind: 'flag', name: 'noListRequestForbidden' }, { kind: 'flag', name: 'listRequestAllowed' }],
  },
  'UI-S08': {
    suite: 'UI-S', spec: `${SPEC.ui05} §制品库错误态`, target: '制品库拉取失败呈现错误态与重试',
    positive: [{ kind: 'text', value: '加载失败' }, { kind: 'text', value: '重试' }],
    precondition: 'injected', knownGap: true,
  },
  'UI-S09': {
    suite: 'UI-S', spec: `${SPEC.ui05} §日志区 / ${SPEC.fiveStates} §4`, target: '日志区面板渲染且空态文案呈现',
    positive: [{ kind: 'flag', name: 'logPanelPresent' }, { kind: 'flag', name: 'logEmpty' }],
    // 加载态与 S01 共用 Fetch 延迟机制（已在 S01 断言）；错误重试态（catch 静默无 DOM）
    // 与断线重连态无入口，转缺陷清单。契约只断言日志区自身可稳定观测的面板与空态。
  },
  'UI-S10': {
    suite: 'UI-S', spec: `${SPEC.fiveStates} §1.1 灰阶可辨`, target: '灰阶开关可逆，五态图标形状可辨',
    positive: [{ kind: 'flag', name: 'grayToggled' }, { kind: 'flag', name: 'shapesDistinct' }],
  },

  // ---------- UI-V 视觉基线与协议（5）----------
  'UI-V01': {
    suite: 'UI-V', spec: `${SPEC.plan} §五 UI-V01`, target: '每基线记录场景/视口/驱动/稳定时刻/sha256，首版由人确认',
    positive: [{ kind: 'field', name: 'baselinePresent', value: true }, { kind: 'field', name: 'confirmedBy', notValue: null }],
    // 计划规定首版须人确认、agent 不得自转正：confirmedBy 为 null 是待人工步骤，不是自动化失败。
    knownGap: true,
  },
  'UI-V02': {
    suite: 'UI-V', spec: `${SPEC.plan} §五 UI-V02`, target: '比对产出 actual_sha256 与机器可判 diff_metric，超阈值 fail',
    positive: [{ kind: 'field', name: 'diffMetricPresent', value: true }, { kind: 'field', name: 'verdictMachineDecidable', value: true }],
  },
  'UI-V03': {
    suite: 'UI-V', spec: `${SPEC.plan} §五 UI-V03`, target: '漂移有归因、决策与人审记录，禁止把更新基线当修测试',
    positive: [{ kind: 'field', name: 'causeRecorded', value: true }, { kind: 'field', name: 'reviewer', notValue: null }],
    // 漂移归因与决策可由脚本产出，但 reviewer 须人签（首版人确认原则，agent 不得自审），留作人工步骤。
    knownGap: true,
  },
  'UI-V04': {
    suite: 'UI-V', spec: `${SPEC.plan} §五 UI-V04`, target: '每步截图带 sha256 / 基线引用 / 场景 id / 比对指标',
    positive: [{ kind: 'flag', name: 'screenshotFieldsComplete' }],
  },
  'UI-V05': {
    suite: 'UI-V', spec: `${SPEC.plan} §五 UI-V05`, target: '基线与容差受 protected_paths 保护，评审绑 commit',
    positive: [{ kind: 'field', name: 'protectedPaths', value: true }, { kind: 'field', name: 'commitBinding', value: true }],
    // protected_paths 在 governance/redlines.yaml 真实存在；commitBinding 仅有 REVIEW.md 文字声明，
    // CI 无机器校验入口且 review_required_paths 未含 evidence/baseline/**，待工程侧补齐，留作人工步骤。
    knownGap: true,
  },

  // ---------- UI-F 业务链路（6）----------
  'UI-F01': {
    suite: 'UI-F', spec: `${SPEC.plan} §六 UI-F01`, target: 'UI 建组件与对接环境后在树/列表可见可选',
    positive: [{ kind: 'flag', name: 'componentVisible' }, { kind: 'flag', name: 'envVisible' }],
  },
  'UI-F02': {
    suite: 'UI-F', spec: `${SPEC.plan} §六 UI-F02`, target: '日常流水线编排/触发/监控/日志，阶段卡全绿并部署测试环境',
    positive: [{ kind: 'flag', name: 'stageGreen' }, { kind: 'flag', name: 'deployed' }, { kind: 'flag', name: 'logVisible' }],
    // 当前 fixture 流水线只编排了构建任务、无部署测试阶段；部署证据待补编排后展开。
    knownGap: true,
  },
  'UI-F03': {
    suite: 'UI-F', spec: `${SPEC.plan} §六 UI-F03`, target: '版本归档流水线产出版本包并进入制品库可复用',
    positive: [{ kind: 'flag', name: 'versionBranch' }, { kind: 'flag', name: 'archived' }, { kind: 'flag', name: 'artifactAvailable' }],
  },
  'UI-F04': {
    suite: 'UI-F', spec: `${SPEC.plan} §六 UI-F04`, target: '转测流水线消费制品库版本包并发布到转测环境',
    positive: [{ kind: 'flag', name: 'versionConsumed' }, { kind: 'flag', name: 'releasedToTest' }],
  },
  'UI-F05': {
    suite: 'UI-F', spec: `${SPEC.plan} §六 UI-F05`, target: '生产流水线经审批门禁后发布到多套环境',
    positive: [{ kind: 'flag', name: 'approvalGate' }, { kind: 'flag', name: 'multiEnvReleased' }],
  },
  'UI-F06': {
    suite: 'UI-F', spec: `${SPEC.plan} §六 UI-F06 / ${SPEC.ui04} §6.2`, target: '异常分支可重试/重投/阶段跳过/灰度回滚，不卡死',
    positive: [{ kind: 'flag', name: 'failureInjected' }, { kind: 'flag', name: 'retried' }, { kind: 'flag', name: 'rolledBack' }],
  },

  // ---------- UI-P 认证与权限守卫（5）----------
  'UI-P01': {
    suite: 'UI-P', spec: `${SPEC.plan} §七 UI-P01`, target: '非 platform-admin 打开 /admin/* 统一跳 forbidden 且不渲染管理内容',
    positive: [{ kind: 'url', value: '/forbidden' }, { kind: 'flag', name: 'adminContentHidden' }],
  },
  'UI-P02': {
    suite: 'UI-P', spec: `${SPEC.plan} §七 UI-P02`, target: '非 orgAdmins 跳 forbidden，组织管理员进入且卡片渲染',
    positive: [{ kind: 'flag', name: 'forbiddenForNonAdmin' }, { kind: 'flag', name: 'enteredForOrgAdmin' }],
    // 本地 kind 环境写入 org_admin 属性后 password grant 重置为 UPDATE_PASSWORD，
    // 组织管理员 fixture 无法经现有 API 建立；管理员侧留待环境修复后展开。
    knownGap: true,
  },
  'UI-P03': {
    suite: 'UI-P', spec: `${SPEC.plan} §七 UI-P03`, target: '清 session 后跳登录并带 redirect，登录后回跳原路径',
    positive: [{ kind: 'url', value: '/user/login' }, { kind: 'url', value: 'redirect' }, { kind: 'flag', name: 'redirectBack' }],
  },
  'UI-P04': {
    suite: 'UI-P', spec: `${SPEC.plan} §七 UI-P04`, target: '密码登录、首登改密、登出与 SSO 回调均可建立会话且不泄露凭据',
    positive: [{ kind: 'flag', name: 'passwordLogin' }, { kind: 'flag', name: 'firstLoginChange' }, { kind: 'flag', name: 'ssoCallback' }],
  },
  'UI-P05': {
    suite: 'UI-P', spec: `${SPEC.plan} §七 UI-P05 / E1`, target: '认证旁路结果显式标注 authBypassed 且与真实认证分册留存',
    positive: [{ kind: 'flag', name: 'authBypassed' }, { kind: 'flag', name: 'manifestSeparated' }],
  },
}

export const SUITES = {
  'UI-B': 12, 'UI-S': 10, 'UI-V': 5, 'UI-F': 6, 'UI-P': 5,
}

const EVIDENCE_KEYS = {
  text: (p, c) => (c.text || '').includes(p.value),
  url: (p, c) => (c.url || '').includes(p.value),
  api: (p, c) => (c.apiCalls || []).some((a) => {
    if (p.value && !a.path.includes(p.value)) return false
    if (p.status) return a.status === p.status
    return a.status >= 200 && a.status < 400
  }),
  flag: (p, c) => (c.flags || {})[p.name] === true,
  count: (p, c) => ((c.counts || {})[p.name] || 0) >= p.value,
  field: (p, c) => p.value !== undefined ? (c.meta || {})[p.name] === p.value : (c.meta || {})[p.name] !== p.notValue,
  shaRef: (p, c) => !!(c.meta || {}).sha256 && c.meta.sha256 === c.meta.referenceSha256,
}

function checkItem(id, p, label) {
  if (!EVIDENCE_KEYS[p.kind]) return `${id}: ${label} 使用未知证据类型 ${p.kind}`
  if (p.kind === 'text' || p.kind === 'url' || p.kind === 'api') {
    if (p.kind === 'api' && !p.value) return `${id}: ${label} api 需给 path`
    if (p.kind !== 'api' && !p.value) return `${id}: ${label} 值为空`
  }
  if (p.kind === 'flag' && !p.name) return `${id}: ${label} flag 缺 name`
  if (p.kind === 'count' && (!p.name || typeof p.value !== 'number')) return `${id}: ${label} count 参数不完整`
  if (p.kind === 'field' && (!p.name || (p.value === undefined && p.notValue === undefined))) return `${id}: ${label} field 参数不完整`
  return null
}

// 契约守卫：缺规范、缺正向证据、非法证据类型一律拒绝；否定式判据不在白名单内。
export function assertContract(ids) {
  const errors = []
  for (const id of ids) {
    const c = CRITERIA[id]
    if (!c) { errors.push(`${id}: 契约缺失`); continue }
    if (!c.spec) errors.push(`${id}: 缺规范引用`)
    if (!c.target) errors.push(`${id}: 缺被测行为描述`)
    if (!SUITES[c.suite]) errors.push(`${id}: 套件归属缺失或非法`)
    if (!Array.isArray(c.positive) || c.positive.length === 0) {
      errors.push(`${id}: 无正向证据（否定式判据不构成通过）`)
    } else {
      for (const p of c.positive) { const e = checkItem(id, p, '正向证据'); if (e) errors.push(e) }
    }
    for (const p of c.forbidden || []) { const e = checkItem(id, p, '反证'); if (e) errors.push(e) }
  }
  if (errors.length) throw new Error(`判据契约校验失败:\n  ${errors.join('\n  ')}`)
}

// 覆盖完整性：契约登记条数必须与计划声明一致；套件声明缺失即报错，不允许静默少跑。
export function assertCoverage() {
  const errors = []
  const counted = Object.values(CRITERIA).filter((c) => !c.artifact)
  const total = Object.values(SUITES).reduce((a, b) => a + b, 0)
  if (counted.length !== total) errors.push(`契约用例数 ${counted.length} 与计划 ${total} 不一致`)
  for (const [suite, want] of Object.entries(SUITES)) {
    const got = counted.filter((c) => c.suite === suite).length
    if (got !== want) errors.push(`${suite}: 契约 ${got} 条，计划 ${want} 条`)
  }
  if (errors.length) throw new Error(`用例覆盖校验失败:\n  ${errors.join('\n  ')}`)
  return { total, suites: { ...SUITES } }
}

// 唯一判定：正向全命中 + 反证全不命中 + 前置满足。
export function verdict(id, ctx) {
  const c = CRITERIA[id]
  if (!c) throw new Error(`未知契约用例: ${id}`)
  if (c.precondition === 'injected' && !ctx.injected) {
    return { ok: false, reason: '注入未命中', spec: c.spec, target: c.target, positive: [], forbidden: [] }
  }
  const hit = (p) => !!EVIDENCE_KEYS[p.kind](p, ctx)
  const positive = c.positive.map((p) => ({ ...p, hit: hit(p) }))
  const forbidden = (c.forbidden || []).map((p) => ({ ...p, hit: hit(p) }))
  return {
    ok: positive.every((p) => p.hit) && forbidden.every((p) => !p.hit),
    spec: c.spec, target: c.target, positive, forbidden,
    injected: !!ctx.injected, knownGap: !!c.knownGap,
  }
}
