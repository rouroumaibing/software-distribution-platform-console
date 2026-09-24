// 平台权限 UI 纯逻辑（utils/permission.ts）契约冒烟。
// 跑法：pnpm test:platform-perm（或 node scripts/platform-perm-smoke.mjs）。
//
// 与 pipeline / service-tree / theme-and-search 同一手法：直接 import 源码 .ts
// （Node ≥22.18 原生类型剥离），测出厂代码本身，防止契约回退。
//
// D3 之后 hub 不存用户表、控制台没有用户目录（ACCOUNT-PERMISSION-MODEL §2.2 /
// ACCOUNT-PERMISSION-DECISIONS §3.5），所以本文件的断言从「主体显示名会补全成
// 张三（z@sdp.io）」改成「只显示真值、并挡住必然绑定不上的输入」。
import assert from 'node:assert/strict'
import {
  failMsg,
  formatExpiryISO,
  knownSubjects,
  parseActions,
  subjectInputHint,
  subjectLabel,
  validateSubjectInput,
} from '../src/utils/permission.ts'

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

// subjectLabel：组带前缀；用户**原样显示 sub**（没有目录可查姓名/邮箱）；
// 空值给占位符。这里刻意断言「不补全」——D3 之前那种 `张三（z@sdp.io）`
// 需要 users 表，表已经不存在了。
check('subjectLabel 组带前缀', () => {
  assert.equal(subjectLabel({ subjectType: 'group', subjectId: '/sdp-admin' }), '组：/sdp-admin')
})
check('subjectLabel 用户原样显示 sub，不截断不补名', () => {
  const sub = '3f2a7c81-9d4e-4f0b-8a11-2c3d4e5f6a7b'
  assert.equal(subjectLabel({ subjectType: 'user', subjectId: sub }), sub)
})
check('subjectLabel 缺失 -> 占位符', () => {
  assert.equal(subjectLabel({ subjectType: 'user' }), '—')
  assert.equal(subjectLabel({}), '—')
  assert.equal(subjectLabel({ subjectType: 'user', subjectId: '   ' }), '—')
})

// knownSubjects：绑定表派生候选（(b′) 的列表来源），去重 + 分类排序。
check('knownSubjects 去重并区分类型', () => {
  const got = knownSubjects([
    { subjectType: 'user', subjectId: 'sub-b' },
    { subjectType: 'user', subjectId: 'sub-a' },
    { subjectType: 'user', subjectId: 'sub-b' },
    { subjectType: 'group', subjectId: '/sdp-admin' },
    { subjectType: 'user', subjectId: '  ' },
    {},
  ])
  assert.deepEqual(got, [
    { subjectType: 'group', subjectId: '/sdp-admin' },
    { subjectType: 'user', subjectId: 'sub-a' },
    { subjectType: 'user', subjectId: 'sub-b' },
  ])
})
check('knownSubjects 空输入 -> []', () => {
  assert.deepEqual(knownSubjects([]), [])
})

// validateSubjectInput：只挡「必然绑定不上」的输入。
check('validateSubjectInput 空值按类型给不同文案', () => {
  assert.ok(validateSubjectInput('user', ''))
  assert.ok(validateSubjectInput('group', '   '))
})
check('validateSubjectInput 含空白一律拒绝', () => {
  assert.ok(validateSubjectInput('user', 'sub with space'))
  assert.ok(validateSubjectInput('group', '/sdp admin'))
})
check('validateSubjectInput 组必须带前导斜杠（§5.3 full.path）', () => {
  assert.ok(validateSubjectInput('group', 'sdp-admin'))
  assert.equal(validateSubjectInput('group', '/sdp-admin'), null)
})
check('validateSubjectInput 用户 sub 不强制 uuid（IdP 可变）', () => {
  assert.equal(validateSubjectInput('user', 'not-a-uuid-but-allowed'), null)
})

// subjectInputHint：非阻塞提醒。
check('subjectInputHint 用户非 uuid 时提醒', () => {
  assert.ok(subjectInputHint('user', 'zhang.san'))
  assert.equal(subjectInputHint('user', '3f2a7c81-9d4e-4f0b-8a11-2c3d4e5f6a7b'), null)
})
check('subjectInputHint 组只有斜杠时提醒', () => {
  assert.ok(subjectInputHint('group', '/'))
  assert.equal(subjectInputHint('group', '/sdp-admin'), null)
})
check('subjectInputHint 空输入不提醒', () => {
  assert.equal(subjectInputHint('user', ''), null)
})

// failMsg：结构化 reasons 优先（409 删除被拒的展示源）。
check('failMsg 优先 reasons', () => {
  assert.equal(failMsg({ response: { data: { reasons: ['a', 'b'] } } }), 'a、b')
})
check('failMsg 退化到 error / message', () => {
  assert.equal(failMsg({ response: { data: { error: 'boom' } } }), 'boom')
  assert.equal(failMsg({ message: 'network' }), 'network')
  assert.equal(failMsg(undefined), '操作失败')
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
