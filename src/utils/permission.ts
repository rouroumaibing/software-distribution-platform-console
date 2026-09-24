// 权限 UI 纯逻辑层（零 import，可被 node 直接 import 断言）。
// 与 utils/pipeline.ts、utils/tree.ts 同一手法：把可测逻辑从 .vue 里抽出来。
//
// D3 之后 hub **不存用户表**（ACCOUNT-PERMISSION-MODEL §2.2），控制台因此也没有
// 「用户目录」可拉。这里只做三件不涉及身份查询的事：
//   1) 把 hub 自己绑定表里的主体去重成候选（knownSubjects）；
//   2) 校验 / 提示手输的主体串（validateSubjectInput / subjectInputHint）；
//   3) 把主体与错误响应渲染成文案（subjectLabel / failMsg）。
// 不编造姓名或邮箱 —— 拿不到就说拿不到，显示真值比显示一个「像人」的假名安全。

export type SubjectType = 'user' | 'group'

// 把用户输入的「权限点」整理成字符串数组：支持换行 / 逗号 / 空格分隔，
// 去空白、去空项。后端把 actions 当字面量校验（ACCOUNT-PERMISSION-MODEL §5），
// 这里只负责把自由文本收敛成干净的列表。
export function parseActions(input: string): string[] {
  return (input ?? '')
    .split(/[\n,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// datetime-local 的值是 "YYYY-MM-DDTHH:mm"，既无秒也无时区；而 hub（Go）的
// time.Time JSON 反序列化要求 RFC3339（带秒 + 时区），直接发会 400。这里统一转
// 成 ISO 字符串（toISOString 自带 UTC + 秒 + Z）。空串 / 非法值返回 null，
// 调用方据此「省略该字段」= 永久授权。
export function formatExpiryISO(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

// 绑定主体的展示名。hub 没有用户目录，所以 `user` 主体能显示的就是它本身
// （Keycloak `sub`），`group` 主体是组路径（带前导斜杠，§5.3）。
// 缺失时给占位符而不是空串，避免表格里出现看不出来的空单元格。
export function subjectLabel(b: { subjectType?: string; subjectId?: string }): string {
  const id = (b.subjectId ?? '').trim()
  if (!id) return '—'
  return b.subjectType === 'group' ? `组：${id}` : id
}

// (b′) 的控制台半边：授权表单不再有「用户目录」可拉，改为「下拉已绑定主体 +
// 手输」。这个函数把已有绑定里的主体去重成候选项 —— 只列 hub 能解释的东西
// （它自己绑定表里的主体），不引入 Keycloak Admin API
// （§2.4.4 零外呼 / ACCOUNT-PERMISSION-DECISIONS §3.2）。
export function knownSubjects(
  bindings: ReadonlyArray<{ subjectType?: string; subjectId?: string }>,
): Array<{ subjectType: SubjectType; subjectId: string }> {
  const seen = new Map<string, { subjectType: SubjectType; subjectId: string }>()
  for (const b of bindings) {
    const id = (b.subjectId ?? '').trim()
    if (!id) continue
    const subjectType: SubjectType = b.subjectType === 'group' ? 'group' : 'user'
    const key = `${subjectType}:${id}`
    if (!seen.has(key)) seen.set(key, { subjectType, subjectId: id })
  }
  return [...seen.values()].sort((a, b) =>
    a.subjectType === b.subjectType
      ? a.subjectId.localeCompare(b.subjectId)
      : a.subjectType.localeCompare(b.subjectType),
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 手输主体的**阻塞性**校验。只挡「一定填错」，不猜意图：
//   - 空 / 含空白：`sub` 与组路径都不含空格，填进去必然绑定不上；
//   - group 必须以 `/` 开头：本 realm 的 groups mapper 是 `full.path=true`，
//     claim 里就是 `/sdp-admin` 这种带前导斜杠的值（§5.3）。少了斜杠，绑定会
//     **静默**不生效 —— 表现为「开了鉴权但恒 403」，最值得在这一步挡住。
// 返回 null = 通过；否则返回可直接展示的错误文案。
export function validateSubjectInput(type: SubjectType, raw: string): string | null {
  const v = (raw ?? '').trim()
  if (!v) return type === 'group' ? '请填写用户组路径' : '请填写用户 sub'
  if (/\s/.test(v)) return '主体不能包含空白字符'
  if (type === 'group' && !v.startsWith('/')) {
    return '用户组须带前导斜杠（如 /sdp-admin）—— 少了它绑定不会生效'
  }
  return null
}

// 手输主体的**非阻塞**提示：填得进去、但形态可疑时提醒一句。
// 之所以不升级成错误：`sub` 由 IdP 决定 —— Keycloak 默认是 uuid，但自定义
// authenticator / 联邦场景下不是 uuid 也合法。硬挡会把人锁在授权之外。
export function subjectInputHint(type: SubjectType, raw: string): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (type === 'user' && !UUID_RE.test(v)) {
    return '这不像 Keycloak 的 `sub`（通常是 uuid）。若这里填的是用户名或邮箱，绑定不会命中 —— 请到 Keycloak 用户详情里复制 `sub`。'
  }
  if (type === 'group' && v === '/') return '只有一个斜杠，不是有效的组路径。'
  return null
}

// 统一把 axios 错误翻成可展示文案：优先结构化的 reasons（如 409 删除被拒理由），
// 其次服务端 error 字段，最后兜底 message。两个权限视图共用。
export function failMsg(e: unknown): string {
  const d = (e as { response?: { data?: { reasons?: string[]; error?: string } } })?.response?.data
  if (d?.reasons?.length) return d.reasons.join('、')
  if (d?.error) return d.error
  return (e as { message?: string })?.message || '操作失败'
}

// 组件级自定义角色（/component-roles）可授予的权限点（§7.3 / hub
// internal/permission/models/role.go 的组件相关项）。这些字符串是中间件真正
// 按字面量校验的 `resource:action`，必须与 hub 侧 vocabulary 逐字对齐 —— 拼错
// 一个字符，授予的角色在该动作上就会静默 403。分组仅用于 UI 展示。
export interface ActionOption {
  value: string
  label: string
}
export interface ActionGroup {
  label: string
  actions: ActionOption[]
}
export const COMPONENT_ROLE_ACTION_GROUPS: ActionGroup[] = [
  {
    label: '组件',
    actions: [
      { value: 'component:read', label: '查看组件' },
      { value: 'component:update', label: '编辑组件' },
      { value: 'component:delete', label: '删除组件' },
      { value: 'component:create', label: '创建组件' },
      { value: 'component:manage', label: '管理组件（全权）' },
    ],
  },
  {
    label: '流水线',
    actions: [
      { value: 'pipeline:read', label: '查看流水线' },
      { value: 'pipeline:trigger', label: '触发流水线' },
      { value: 'pipeline:create', label: '创建流水线' },
      { value: 'pipeline:update', label: '编辑流水线' },
      { value: 'pipeline:delete', label: '删除流水线' },
    ],
  },
  {
    label: '审批 / 配置 / 制品',
    actions: [
      { value: 'approval:approve', label: '审批运行' },
      { value: 'config:read', label: '查看配置' },
      { value: 'config:update', label: '编辑配置' },
      { value: 'artifact:read', label: '查看制品' },
      { value: 'artifact:download', label: '下载制品' },
    ],
  },
]

// 把一组勾选的 action 值拍平成去重数组（createCrud 的 payload 用）。
export function collectActions(groups: ActionGroup[]): string[] {
  const out: string[] = []
  for (const g of groups) for (const a of g.actions) out.push(a.value)
  return out
}
