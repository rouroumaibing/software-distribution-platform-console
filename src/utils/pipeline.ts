/**
 * 流水线编排的纯逻辑层 —— **零 import**，可被 node 直接 import 做断言
 * （与 `utils/search.ts` / `utils/theme.ts` 同一手法）。
 *
 * 这里只放「可判定的规则」，不放 Vue 状态、不放 axios：
 *   1. 子任务类型**派生**（§7.4 / 附 D.4：不露原词、由配置派生）
 *   2. 阶段 executionMode 翻转
 *   3. 重排（阶段 sequence / 子任务 displayOrder）
 *   4. 编排请求体构造 + JSON/YAML 双视图序列化（附 D.4）
 *   5. 删除 verdict 读取（§7.4：前端零判断，只渲染后端 409 + {reasons}）
 */

// ---------------------------------------------------------------------------
// 1. 子任务类型派生
// ---------------------------------------------------------------------------

/** 内部派发码。**不是用户可选的分类**（§7.4 拍板）。 */
export type DerivedTaskType = 'Build' | 'Release' | 'Approval'

/** 派生判据的输入：只取「配置里有没有填」这一件事。 */
export interface TaskDerivationInput {
  /** 发布目标（release target）。填了 → 发布任务。
   *  ⚠️ hub 的 `releaseConfig`（= runner `ReleaseSpec`）**没有任务级"发布目标"字段**
   *  —— 目标在**触发**时经 `TriggerRequest.targetId` 选定。此字段保留是为了兼容
   *  原型措辞与将来可能出现的任务级目标，当前 console 表单不产出它。 */
  releaseTarget?: string
  /** 灰度 / rollout。填了 → 发布任务（与原型 deriveType 一致） */
  rollout?: string
  /** **发布配置已填**（chart / manifest）。填了 → 发布任务。
   *  这是 console 表单侧真正使用的信号 —— 对应 hub 的 `release_config` 列，
   *  也是 附 D.3 字段表里 Release 的实际字段集。 */
  hasReleaseConfig?: boolean
  /** 审批人。填了 → 人工审核阶段。对应 `approval_config.allowedApprovers`。 */
  approvers?: string
}

/** 内部工具：把可空字符串归一成「是否有实质内容」。
 *  刻意 trim 后判空 —— 原型用的是 JS 真值判断，空格串会被误判为"填了"，
 *  那会派生出 Release 却没有任何发布配置，属于静默错编。 */
function filled(v?: string): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * 由配置派生内部派发码。优先级 Release > Approval > Build。
 * 与 hub `pipeline_task_templates` 的 `release_config` / `approval_config` 列一致 ——
 * `type` 本就是配置的派生属性。
 */
export function deriveTaskType(t: TaskDerivationInput): DerivedTaskType {
  if (filled(t.releaseTarget) || filled(t.rollout) || t.hasReleaseConfig === true) return 'Release'
  if (filled(t.approvers)) return 'Approval'
  return 'Build'
}

/** 产品语言描述（编辑器**只**显示这一层，不露 Build/Release/Approval 原词）。 */
export function taskNature(t: TaskDerivationInput): string {
  switch (deriveTaskType(t)) {
    case 'Release':
      return '发布任务'
    case 'Approval':
      return '人工审核阶段'
    default:
      return '构建 / 运行任务'
  }
}

/**
 * 由**已落库的 `type`** 反查产品语言（编辑器列表用）。
 *
 * 与 `taskNature()` 的分工：`taskNature` 是「配置 → 语言」（表单里用户还没提交，
 * 只能派生）；本函数是「已落库 type → 语言」（列表里 type 已是 hub 的权威值，
 * 不应再用配置反推 —— 配置缺失时会把 Release 任务显示成构建任务）。
 * 两者共用同一套文案常量，避免措辞漂移。
 */
export function natureFromTaskType(type: DerivedTaskType): string {
  switch (type) {
    case 'Release':
      return '发布任务'
    case 'Approval':
      return '人工审核阶段'
    default:
      return '构建 / 运行任务'
  }
}

/** 产品语言 → 任务卡图标（纯装饰，三态各一，与原型一致）。 */
export function taskTypeIcon(type: DerivedTaskType): string {
  switch (type) {
    case 'Release':
      return '⬇'
    case 'Approval':
      return '✓'
    default:
      return '⌘'
  }
}

/** 产品语言 → 任务卡图标样式类（走全局 tokens：--accent / --succeeded-fg；Approval 见注释）。 */
export function taskTypeClass(type: DerivedTaskType): string {
  switch (type) {
    case 'Release':
      return 'ti-release'
    case 'Approval':
      return 'ti-approval'
    default:
      return 'ti-build'
  }
}

// ---------------------------------------------------------------------------
// 2. 阶段执行模式 + 重排
// ---------------------------------------------------------------------------

export type StageExecutionMode = 'parallel' | 'serial'

export const STAGE_MODES: StageExecutionMode[] = ['parallel', 'serial']

export function isStageExecutionMode(v: unknown): v is StageExecutionMode {
  return v === 'parallel' || v === 'serial'
}

/** 「并行 / 串行」一键切换（阶段头那个 mini 按钮）。 */
export function nextExecutionMode(mode: StageExecutionMode): StageExecutionMode {
  return mode === 'serial' ? 'parallel' : 'serial'
}

/** 阶段模式的中文标签。 */
export function executionModeLabel(mode: StageExecutionMode): string {
  return mode === 'serial' ? '串行' : '并行'
}

/**
 * 把 `index` 处的元素沿 `dir` 方向移动一位，返回**新数组**（不改原数组）。
 * 越界（已在首/尾）时原样返回一份拷贝 —— 调用方据此判断"是否真的动了"。
 */
export function moveItem<T>(arr: readonly T[], index: number, dir: 'up' | 'down'): T[] {
  const next = [...arr]
  const to = dir === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= next.length || to < 0 || to >= next.length) return next
  const tmp = next[index] as T
  next[index] = next[to] as T
  next[to] = tmp
  return next
}

/** 是否发生了位移（用于决定要不要标脏 / 发请求）。 */
export function moveChanged<T>(arr: readonly T[], index: number, dir: 'up' | 'down'): boolean {
  const to = dir === 'up' ? index - 1 : index + 1
  return index >= 0 && index < arr.length && to >= 0 && to < arr.length
}

/** 阶段序号前缀（①②③…），与原型的 stage-no 视觉对齐。 */
export function circled(i: number): string {
  const chars = '①②③④⑤⑥⑦⑧⑨⑩'
  return chars[i] ?? `${i + 1}.`
}

// ---------------------------------------------------------------------------
// 3. 请求体构造 + JSON / YAML 序列化（附 D.4）
// ---------------------------------------------------------------------------

export interface PipelineRequestTask {
  type: DerivedTaskType
  name: string
  displayOrder: number
  image?: string
  command?: string[]
  args?: string[]
  timeoutSeconds?: number
}

export interface PipelineRequestStage {
  name: string
  sequence: number
  executionMode: StageExecutionMode
  tasks: PipelineRequestTask[]
}

export interface PipelineRequestBody {
  componentId: string
  name: string
  kind: string
  description?: string
  stages: PipelineRequestStage[]
}

export interface PipelineRequest {
  method: 'POST' | 'PUT'
  url: string
  body: PipelineRequestBody
}

/**
 * 生成编排请求体（原型 `buildPipelineRequest()` 的同义实现）。
 * `existingId` 有值 = 已在 hub → `PUT /pipelines/:id`；否则 → `POST /pipelines`。
 */
export function buildPipelineRequest(
  existingId: string | undefined,
  body: PipelineRequestBody,
): PipelineRequest {
  return {
    method: existingId ? 'PUT' : 'POST',
    url: existingId ? `/api/v1/pipelines/${existingId}` : '/api/v1/pipelines',
    body,
  }
}

/**
 * ⚠️ 已知落差（附 D.4）：hub 的 `POST /pipelines` 是**扁平创建**，阶段 / 任务必须经
 * `POST /pipelines/:id/stages` → `POST /stages/:id/tasks` 级联落库，**没有"整 DAG 一次
 * 提交"端点**。因此 `buildPipelineRequest()` 返回的 body 是**产品视图**，不是实际发出的
 * 那一个包 —— 预览面板必须同时展示下面这份「实际调用序列」，否则就是在骗用户。
 *
 * 本编辑器里结构性增删（建 / 删阶段、建 / 删 / 改子任务）都是**即时落库**的，
 * `[保存]` 只冲刷三类局部改动，故展开序列与之严格一一对应：
 *   ① 流水线元信息 → `PUT /pipelines/:id`
 *   ② 每个阶段的 `sequence` + `executionMode` → `PUT /stages/:id`（n 次）
 *   ③ 每个阶段内子任务的 `displayOrder` → `PUT /tasks/:id`（Σ 子任务数次）
 */
export function expandPipelineCalls(
  pipelineId: string,
  body: PipelineRequestBody,
  stageIds: readonly string[],
): string[] {
  const lines: string[] = [
    `PUT    /api/v1/pipelines/${pipelineId}    （元信息：name / kind / description）`,
  ]
  body.stages.forEach((st, i) => {
    const sid = stageIds[i] ?? '<stageId>'
    lines.push(
      `PUT    /api/v1/stages/${sid}    （「${st.name}」sequence=${st.sequence} · executionMode=${st.executionMode}）`,
    )
    if (st.tasks.length > 0) {
      lines.push(
        `PUT    /api/v1/tasks/:id  × ${st.tasks.length}    （子任务 displayOrder 重排）`,
      )
    }
  })
  return lines
}

/** YAML 标量序列化（与原型 `yamlScalar` 同义）。 */
export function yamlScalar(v: unknown): string {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return String(v)
  const s = String(v)
  if (s === '' || !/^[A-Za-z0-9_./@-]+$/.test(s)) return JSON.stringify(s)
  return s
}

/** 递归转 YAML（与原型 `objToYaml` 同义：数组项 `- ` 前缀、跳过 undefined/null）。 */
export function objToYaml(obj: unknown, indent = ''): string {
  const pad = '  '
  if (Array.isArray(obj)) {
    if (obj.length === 0) return indent + '[]\n'
    let out = ''
    for (const item of obj) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const inner = objToYaml(item, indent + pad)
        // 首行加 "- " 前缀
        out += inner.replace(indent + pad, indent + '- ')
      } else {
        out += indent + '- ' + yamlScalar(item) + '\n'
      }
    }
    return out
  }
  if (obj && typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>)
    if (entries.length === 0) return indent + '{}\n'
    let out = ''
    for (const [k, val] of entries) {
      if (val === undefined || val === null) continue
      if (val && typeof val === 'object') out += indent + k + ':\n' + objToYaml(val, indent + pad)
      else out += indent + k + ': ' + yamlScalar(val) + '\n'
    }
    return out
  }
  return indent + yamlScalar(obj) + '\n'
}

// ---------------------------------------------------------------------------
// 4. 删除 verdict（§7.4：前端零判断，只渲染后端返回）
// ---------------------------------------------------------------------------

export interface DeleteVerdict {
  /** true = 后端拒绝删除（渲染「无法删除」弹窗）。 */
  blocked: boolean
  /** 后端逐条理由，**原样透传**，前端不加工、不排序。 */
  reasons: string[]
  /** 兜底消息（reasons 为空时显示）。 */
  message: string
}

/**
 * 读取删除结果。**这是唯一的判定点** —— 前端不得自己推断影响面（§7.4 / 附 C）。
 * `body` 形态即 hub 的 `Envelope{ error?, errorCode?, reasons? }`。
 */
export function readDeleteVerdict(status?: number, body?: unknown): DeleteVerdict {
  const b = (body ?? {}) as { error?: unknown; reasons?: unknown }
  const reasons = Array.isArray(b.reasons)
    ? b.reasons.map((r) => String(r)).filter((s) => s.trim() !== '')
    : []
  return {
    blocked: status === 409 || reasons.length > 0,
    reasons,
    message: typeof b.error === 'string' && b.error ? b.error : '删除失败',
  }
}

/** 强确认：输入的名称必须与流水线名**完全一致**（trim 后比对）。 */
export function isDeleteConfirmed(input: string, name: string): boolean {
  return input.trim() !== '' && input.trim() === name.trim()
}

/** 从 axios 异常里取出 status / body（唯一碰 axios 形状的地方，仍保持无 import）。 */
export function readErrorAxios(err: unknown): { status?: number; body?: unknown; message: string } {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string } | undefined
  return {
    status: e?.response?.status,
    body: e?.response?.data,
    message: e?.message ?? '未知错误',
  }
}

// ---------------------------------------------------------------------------
// 5. 「最近运行」列
// ---------------------------------------------------------------------------

export interface RunLike {
  pipelineId: string
  phase: string
  createdAt: string
  startTime?: string
}

/**
 * 每条流水线取**最近一次运行**（按 createdAt 降序取首个）。
 * 流水线列表的「最近运行」列用 `GET /runs?componentId=<id>` **一次**取回后在客户端分组，
 * 避免每条流水线打一次 `GET /pipelines/:id/runs`（N+1）。
 */
export function pickLatestRuns(runs: readonly RunLike[]): Record<string, RunLike> {
  const out: Record<string, RunLike> = {}
  for (const r of runs) {
    const cur = out[r.pipelineId]
    if (!cur || String(r.createdAt) > String(cur.createdAt)) out[r.pipelineId] = r
  }
  return out
}

/** 运行相位 → 产品语言（列表 chip 用）。 */
export function runPhaseLabel(phase: string): string {
  switch (phase) {
    case 'Pending':
      return '排队中'
    case 'Running':
      return '运行中'
    case 'WaitingApproval':
      return '待审批'
    case 'Succeeded':
      return '成功'
    case 'Failed':
      return '失败'
    case 'Cancelled':
      return '已取消'
    default:
      return phase || '—'
  }
}

/**
 * 相位 → 全局徽章类名。刻意复用 tokens.css 里**已存在**的 `.b-*`（§8.1 六态色：
 * 图标 + 文字 + 色三通道），不自造 `st-*` —— 自造类若没在全局定义，状态色会静默失效
 * （前一轮 PermissionsTab 就踩过「引用未定义令牌 ⇒ 边框文字色静默丢失」）。
 * 与 `.b-*` 配套的是 `.badge`（容器）与 `.badge .pt`（圆点）。
 */
export function runPhaseClass(phase: string): string {
  switch (phase) {
    case 'Succeeded':
      return 'b-succ'
    case 'Failed':
      return 'b-fail'
    case 'Running':
      return 'b-run'
    case 'WaitingApproval':
      return 'b-warn'
    // Pending（排队中）与 Cancelled（已取消）都用中性灰 —— 二者都不是"进行中"，
    // 也不该借成功/失败色。
    case 'Cancelled':
    case 'Pending':
    default:
      return 'b-pend'
  }
}

// ---------------------------------------------------------------------------
// 6. 版本历史 / 对比 / 回滚（C-09）
// ---------------------------------------------------------------------------
//
// 这一节只放**可判定的呈现规则**：怎么把 hub 的 diff 结构摆成人能读的表格、
// 字段名怎么翻成产品语言。判定"改没改"完全在 hub（`models.DiffSnapshots`），
// 前端**不做**任何自己的比较 —— 两份 diff 实现必然漂移，那时候用户看到的就
// 不是后端认定的差异了（与 §7.4「删除 verdict 前端零判断」同一原则）。

/** 与 hub `models.ChangeType` 对齐（added / removed / modified）。 */
export type VersionChange = 'added' | 'removed' | 'modified'

/** 版本号展示：`v3（当前）` / `v2`。 */
export function versionLabel(version: number, isCurrent: boolean): string {
  return isCurrent ? `v${version}（当前）` : `v${version}`
}

/** 变更类型的产品语言。 */
export function changeLabel(change: VersionChange): string {
  switch (change) {
    case 'added':
      return '新增'
    case 'removed':
      return '移除'
    default:
      return '修改'
  }
}

/**
 * 变更类型的徽章类名。刻意复用 tokens.css 里**已存在**的 `.b-*`
 * （`.b-succ` / `.b-fail` / `.b-warn`；§8.1 六态色）—— 自造类若没在全局定义，
 * 状态色会静默失效（PermissionsTab 踩过引用未定义令牌的坑）。
 */
export function changeClass(change: VersionChange): string {
  switch (change) {
    case 'added':
      return 'b-succ'
    case 'removed':
      return 'b-fail'
    default:
      return 'b-warn'
  }
}

/**
 * hub 侧字段名 → 产品语言。**未知字段原样返回**：宁可露出 `rolloutConfig`
 * 也不要把不认识的字段藏起来或错译 —— 静默吞掉一个字段名，用户就完全看不到
 * 那一处改动。
 */
export function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    sequence: '次序',
    executionMode: '执行模式',
    displayOrder: '子任务顺序',
    type: '任务类型',
    image: '镜像',
    scriptPath: '脚本路径',
    scriptArgs: '脚本参数',
    command: '命令',
    args: '参数',
    produces: '产出',
    consumes: '依赖产物',
    retryPolicy: '重试策略',
    releaseConfig: '发布配置',
    rolloutConfig: '灰度配置',
    approvalConfig: '审批配置',
    timeoutSeconds: '超时（秒）',
  }
  return map[field] ?? field
}

/** 单字段值的展示：空值给一个显式占位，而不是留白（留白看起来像渲染坏了）。 */
export function showFieldValue(value: string): string {
  const s = value ?? ''
  if (s === '') return '（空）'
  if (s === 'null') return '（未设置）'
  return s
}

/** 版本来源（作者 + 时间）的一行摘要。createdBy 为空时只说时间。 */
export function versionOrigin(createdBy: string | undefined, createdAt: string): string {
  const t = String(createdAt ?? '').replace('T', ' ').slice(0, 19)
  const who = (createdBy ?? '').trim()
  return who ? `${who} · ${t}` : t
}

/** 该版本与前版的差异标记。**未知**（undefined）必须与"无差异"分开渲染。 */
export function identicalMark(identicalToPrevious: boolean | undefined): string {
  if (identicalToPrevious === undefined) return ''
  return identicalToPrevious ? '与前版无差异' : ''
}

/** diff 汇总 → 一行产品语言。全空 = 两份定义完全相同。 */
export function summarizeDiff(summary: {
  stagesAdded: number
  stagesRemoved: number
  stagesModified: number
  tasksAdded: number
  tasksRemoved: number
  tasksModified: number
}): string {
  const parts: string[] = []
  const stage = [
    summary.stagesAdded ? `${summary.stagesAdded} 新增` : '',
    summary.stagesRemoved ? `${summary.stagesRemoved} 移除` : '',
    summary.stagesModified ? `${summary.stagesModified} 修改` : '',
  ].filter(Boolean)
  if (stage.length) parts.push(`阶段：${stage.join(' / ')}`)
  const task = [
    summary.tasksAdded ? `${summary.tasksAdded} 新增` : '',
    summary.tasksRemoved ? `${summary.tasksRemoved} 移除` : '',
    summary.tasksModified ? `${summary.tasksModified} 修改` : '',
  ].filter(Boolean)
  if (task.length) parts.push(`子任务：${task.join(' / ')}`)
  return parts.length ? parts.join(' · ') : '两份定义完全相同'
}

/** 渲染用的扁平行：阶段在前、子任务在后，字段差异预先翻成产品语言。 */
export interface VersionDiffRow {
  kind: 'stage' | 'task'
  name: string
  /** 子任务所属阶段（阶段行为空）。 */
  stage?: string
  change: VersionChange
  fields: { label: string; from: string; to: string }[]
}

/**
 * 把 hub 的 diff 结构摊平成表格行。顺序**照抄后端**（后端已按名称稳定排序），
 * 前端不再排一次 —— 两处排序规则不一致时，同一份 diff 会在两个地方呈现不同
 * 顺序，而用户会以为其中一次是错的。
 */
export function diffRows(diff: {
  stages: { name: string; change: VersionChange; fields?: { field: string; from: string; to: string }[] }[]
  tasks: {
    stage: string
    name: string
    change: VersionChange
    fields?: { field: string; from: string; to: string }[]
  }[]
}): VersionDiffRow[] {
  const toFields = (fields?: { field: string; from: string; to: string }[]) =>
    (fields ?? []).map((f) => ({
      label: fieldLabel(f.field),
      from: showFieldValue(f.from),
      to: showFieldValue(f.to),
    }))

  const rows: VersionDiffRow[] = []
  for (const s of diff.stages ?? []) {
    rows.push({ kind: 'stage', name: s.name, change: s.change, fields: toFields(s.fields) })
  }
  for (const t of diff.tasks ?? []) {
    rows.push({ kind: 'task', name: t.name, stage: t.stage, change: t.change, fields: toFields(t.fields) })
  }
  return rows
}

/**
 * 回滚到 `target` 是否是无操作。当前版 = 目标版时，回滚只会白记一版。
 * hub 侧回滚是**追加**语义（不重写历史），所以"回滚到当前版"不会出错，只是没意义。
 */
export function isNoopRollback(target: number, current: number): boolean {
  return target === current
}

/**
 * 回滚确认文案。回滚替换的是**结构**（阶段 + 子任务），不是流水线元信息
 * （name/kind/description）—— hub 的回滚只重建结构，文案必须与之一致，
 * 否则用户会以为改名也被还原了。
 *
 * 这里用「」引号而不是 Markdown 的 `**` —— 该串走 `{{ }}` 直接渲染成文本，
 * Markdown 标记不会有任何效果，只会把星号原样露给用户。
 */
export function rollbackWarning(target: number): string {
  return `将用 v${target} 的阶段与子任务「替换」当前结构；流水线名称 / 类型 / 描述不受影响。回滚本身会记为一版新的历史，旧版本不会被删除。`
}
