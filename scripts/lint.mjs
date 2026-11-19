// 零依赖风格门：检查 TypeScript/Vue 源码的机械风格约束（不替代类型检查）。
// 检查项：无行尾空白、无 tab 缩进、文件以单个换行结尾、无冲突标记残留。
// 用法：node scripts/lint.mjs [目录...]，默认扫 src/ scripts/，rc=0 通过。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['src', 'scripts']
const exts = ['.ts', '.vue', '.mjs', '.js']
const files = []
function walk(p) {
  let st
  try { st = statSync(p) } catch { return }
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e))
  } else if (exts.some((x) => p.endsWith(x))) {
    files.push(p)
  }
}
roots.forEach(walk)

let bad = 0
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  const lines = text.split('\n')
  lines.forEach((ln, i) => {
    if (/[ \t]+$/.test(ln)) { console.error(`${f}:${i + 1} trailing whitespace`); bad++ }
    if (/^\t/.test(ln)) { console.error(`${f}:${i + 1} tab indentation`); bad++ }
  })
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) { console.error(`${f} conflict marker`); bad++ }
  if (text && !text.endsWith('\n')) { console.error(`${f} missing final newline`); bad++ }
}

if (bad) {
  console.error(`lint: ${bad} issue(s) in ${files.length} files`)
  process.exit(1)
}
console.log(`lint: PASS (${files.length} files)`)
