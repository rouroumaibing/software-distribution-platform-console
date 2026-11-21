// 统一契约执行关卡：验证脚本只产出观测事实，判定权收口在此。
// 脚本不得自带 ok / spec / target / positive / forbidden —— 结构上杜绝绕过契约的假绿。
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { assertContract, assertCoverage, verdict, CRITERIA, SPEC } from './criteria.mjs'

const FORBIDDEN_RESULT_KEYS = ['ok', 'spec', 'target', 'positive', 'forbidden', 'reason']
const now = () => new Date().toISOString()

function assertObservation(id, obs, extra) {
  for (const key of FORBIDDEN_RESULT_KEYS) {
    if (obs && Object.prototype.hasOwnProperty.call(obs, key)) {
      throw new Error(`${id}: 观测里含判定字段 ${key}，脚本只能产出观测事实`)
    }
    if (extra && Object.prototype.hasOwnProperty.call(extra, key)) {
      throw new Error(`${id}: 附加信息里含判定字段 ${key}，判定只能来自契约`)
    }
  }
}

export function createSuite(cfg) {
  const coverage = assertCoverage()
  const caseIds = cfg.caseIds || []
  assertContract(caseIds)

  const all = Object.entries(CRITERIA).filter(([, c]) => c.suite === cfg.suite && !c.artifact).map(([id]) => id)
  const missing = all.filter((id) => !caseIds.includes(id))
  const unknown = caseIds.filter((id) => !all.includes(id))
  if (missing.length) throw new Error(`${cfg.suite}: 套件未声明契约用例 ${missing.join(',')}（覆盖不完整）`)
  if (unknown.length) throw new Error(`${cfg.suite}: 声明了非本套件用例 ${unknown.join(',')}`)

  const results = []
  const log = []
  const say = (s) => { const line = `[${now()}] ${s}`; log.push(line); console.log(s) }

  function record(entry) {
    results.push(entry)
    const v = entry.verdict
    const tags = []
    if (entry.skipped) tags.push('SKIP')
    else if (entry.knownGap) tags.push('KNOWN-GAP')
    else tags.push(entry.ok ? 'PASS' : 'FAIL')
    const hits = v ? `,pos=${v.positive.filter((p) => p.hit).length}/${v.positive.length}` : ''
    say(`  ${tags[0]} ${entry.id} ${entry.name || ''} (${entry.ms || 0}ms${hits})`)
  }

  async function run(id, name, observe, extra = {}) {
    const declared = caseIds.includes(id) || Object.entries(CRITERIA).some(([key, c]) => key === id && c.artifact && c.suite === cfg.suite)
    if (!declared) throw new Error(`${cfg.suite}: 用例 ${id} 未在套件声明，禁止运行未登记用例`)
    assertObservation(id, observe, extra)
    const t0 = Date.now()
    try {
      const obs = (await observe()) || {}
      assertObservation(id, obs, extra)
      const v = verdict(id, obs)
      const isKnownGap = !!v.knownGap && !v.ok
      const entry = {
        id, name, suite: cfg.suite,
        ok: v.ok, skipped: false, knownGap: isKnownGap,
        ms: Date.now() - t0,
        verdict: v,
        observation: {
          url: obs.url, injected: obs.injected,
          text: obs.text ? String(obs.text).slice(0, 600) : undefined,
          apiCalls: obs.apiCalls ? obs.apiCalls.slice(0, 60) : undefined,
          flags: obs.flags, counts: obs.counts, meta: obs.meta,
        },
        screenshot: obs.screenshot || extra.screenshot,
        ...extra,
      }
      // extra 可能带诊断字段，但 ok/判定字段已被 assertObservation 拒绝。
      entry.ok = v.ok
      record(entry)
      return entry
    } catch (e) {
      const entry = { id, name, suite: cfg.suite, ok: false, skipped: false, knownGap: false, ms: Date.now() - t0, error: e.message }
      record(entry)
      return entry
    }
  }

  function skip(id, name, reason) {
    const entry = { id, name, suite: cfg.suite, ok: null, skipped: true, knownGap: false, reason, ms: 0 }
    record(entry)
    return entry
  }

  function finish(meta = {}) {
    const failed = results.filter((r) => !r.ok && !r.skipped && !r.knownGap).length
    const passed = results.filter((r) => r.ok).length
    const skipped = results.filter((r) => r.skipped).length
    const knownGaps = results.filter((r) => r.knownGap).length
    const manifest = {
      stamp: cfg.stamp, suite: cfg.suite, base: cfg.base,
      auth: cfg.auth, fixtureRun: cfg.fixtureRun,
      criteria: 'scripts/criteria.mjs',
      runner: 'scripts/contract-runner.mjs',
      coverage, declared: caseIds,
      total: results.length, passed, failed, skipped, knownGaps,
      results, chain: cfg.chain,
      ...meta,
    }
    writeFileSync(path.join(cfg.out, 'manifest.json'), JSON.stringify(manifest, null, 2))
    writeFileSync(path.join(cfg.out, cfg.logFile || `${cfg.suite}.log`), log.join('\n') + '\n')
    say(`${cfg.suite} 完成：${passed}/${results.length} PASS, failed=${failed}, skipped=${skipped}, known-gap=${knownGaps} evidence=${cfg.out}`)
    if (failed) process.exitCode = 1
    return manifest
  }

  return { say, run, skip, finish, results, coverage }
}
