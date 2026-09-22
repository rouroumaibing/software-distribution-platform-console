// 平台权限 UI 纯逻辑（utils/permission.ts）契约冒烟。
// 跑法：pnpm test:platform-perm（或 node scripts/platform-perm-smoke.mjs）。
//
// 与 pipeline / service-tree / theme-and-search 同一手法：直接 import 源码 .ts
// （Node ≥22.18 原生类型剥离），测出厂代码本身，防止契约回退。
import assert from 'node:assert/strict'
import { formatExpiryISO, parseActions, subjectLabel } from '../src/utils/permission.ts'

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

// parseActions：换行 / 逗号 / 空格 混合，去空白、去空项。
check('parseActions 混合分隔', () => {
  assert.deepEqual(parseActions('a, b\nc  d'), ['a', 'b', 'c', 'd'])
})
check('parseActions 中文逗号', () => {
  assert.deepEqual(parseActions('平台:读，平台:写'), ['平台:读', '平台:写'])
})
check('parseActions 全空白 -> []', () => {
  assert.deepEqual(parseActions('   \n  '), [])
})
check('parseActions 空输入不崩', () => {
  assert.deepEqual(parseActions(''), [])
  assert.deepEqual(parseActions(undefined), [])
})

// formatExpiryISO：datetime-local 的 "YYYY-MM-DDTHH:mm" 必须补成 RFC3339（带秒 + Z），
// 否则 Go time.Time 反序列化会 400。这是真实踩坑点，必须钉住。
check('formatExpiryISO 空串 -> null', () => {
  assert.equal(formatExpiryISO(''), null)
  assert.equal(formatExpiryISO(undefined), null)
})
check('formatExpiryISO 转成 RFC3339 带 Z', () => {
  const iso = formatExpiryISO('2026-09-23T10:30')
  assert.ok(iso !== null)
  assert.ok(iso.endsWith('Z'), `期望以 Z 结尾，实际 ${iso}`)
  assert.ok(iso.includes(':30:00'), `期望含秒，实际 ${iso}`)
  // 能原样解析回同一个时刻
  assert.equal(new Date(iso).toISOString(), iso)
})
check('formatExpiryISO 非法值 -> null', () => {
  assert.equal(formatExpiryISO('not-a-date'), null)
})

// subjectLabel：组带前缀、用户带邮箱、缺失退回短 id。
check('subjectLabel 组带前缀', () => {
  assert.equal(subjectLabel({ subjectType: 'group', subjectId: '/sdp-admin' }), '组：/sdp-admin')
})
check('subjectLabel 用户带邮箱', () => {
  assert.equal(
    subjectLabel({ subjectType: 'user', subjectId: 'u1', userName: '张三', userEmail: 'z@sdp.io' }),
    '张三（z@sdp.io）',
  )
})
check('subjectLabel 用户缺失退回短 id', () => {
  assert.equal(subjectLabel({ subjectType: 'user', subjectId: '1234567890abcdef' }), '12345678')
})

// ===========================================================================
const total = cases.length
console.log(`\n平台权限 UI 纯逻辑冒烟：${pass}/${total} 通过`)
cases.forEach((c) => console.log(c))
if (pass !== total) {
  console.error('\n存在失败用例')
  process.exit(1)
}
console.log('')
