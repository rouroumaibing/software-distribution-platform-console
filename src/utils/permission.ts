// 权限 UI 纯逻辑层（零 import，可被 node 直接 import 断言）。
// 与 utils/pipeline.ts、utils/tree.ts 同一手法：把可测逻辑从 .vue 里抽出来。

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

// 绑定主体的展示名：组带「组：」前缀；用户优先用名称 + 邮箱，缺失时退回短 id。
export function subjectLabel(b: {
  subjectType?: string
  subjectId?: string
  userName?: string
  userEmail?: string
}): string {
  if (b.subjectType === 'group') return `组：${b.subjectId ?? ''}`
  if (b.subjectType === 'user') {
    if (b.userName) return b.userEmail ? `${b.userName}（${b.userEmail}）` : b.userName
    return (b.subjectId ?? '').slice(0, 8)
  }
  return (b.subjectId ?? '').slice(0, 8)
}
