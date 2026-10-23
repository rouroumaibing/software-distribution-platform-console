// runner 安装命令冒烟（ADR-0002）：buildJoinCommand 渲染契约 + copyText 降级。
// 跑法：pnpm test:target（或 node scripts/target-smoke.mjs）。
//
// 与 platform-perm / agent-op 同一手法：直接 import 源码 .ts（Node ≥22.18 原生
// 类型剥离），测出厂代码本身，防止契约回退。runnerInstall.ts 对 '@/api/target'
// 只 import type，运行时零解析，node 可直接加载。
import assert from 'node:assert/strict'
import { buildJoinCommand, copyText } from '../src/utils/runnerInstall.ts'

let pass = 0
let total = 0
const cases = []
async function check(name, fn) {
  total++
  try {
    await fn()
    cases.push(`  ✓ ${name}`)
    pass++
  } catch (e) {
    cases.push(`  ✗ ${name}\n      ${e.message}`)
  }
}

const bundle = {
  targetName: 'tx-staging-bj',
  gatewayUrl: 'wss://www.sdpworkflow.com:8443/gateway/ws',
  apiBaseUrl: 'https://www.sdpworkflow.com:8443',
  caPem: '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----\n',
  caFingerprint: 'sha256:ab12cd34',
  enrollToken: 'tok-123',
  expiresIn: '24h',
  runnerVersion: 'v0.0.1',
}

await check('envFile 含网关/基址/token/指纹/版本五要素', () => {
  const c = buildJoinCommand(bundle)
  assert.equal(c.envFile.includes('HUB_GATEWAY_URL=wss://www.sdpworkflow.com:8443/gateway/ws'), true)
  assert.equal(c.envFile.includes('SDP_HUB_BASE_URL=https://www.sdpworkflow.com:8443'), true)
  assert.equal(c.envFile.includes('SDP_ENROLL_TOKEN=tok-123'), true)
  assert.equal(c.envFile.includes('SDP_HUB_CA_FINGERPRINT=sha256:ab12cd34'), true)
  assert.equal(c.envFile.includes('SDP_RUNNER_VERSION=v0.0.1'), true)
})

await check('envFile 的 CA 路径与 caScript 落盘路径一致', () => {
  const c = buildJoinCommand(bundle)
  assert.equal(c.envFile.includes('SDP_HUB_CA_FILE=/etc/sdp-runner/ca.crt'), true)
  assert.equal(c.caScript.includes('/etc/sdp-runner/ca.crt'), true)
})

await check('caScript 内嵌 CA 原文并做指纹自校验（kubeadm 语义）', () => {
  const c = buildJoinCommand(bundle)
  assert.equal(c.caScript.includes('-----BEGIN CERTIFICATE-----'), true)
  assert.equal(c.caScript.includes('ab12cd34'), true)
  assert.equal(c.caScript.includes('openssl x509 -in /etc/sdp-runner/ca.crt -noout -fingerprint -sha256'), true)
  assert.equal(c.caScript.includes('diff /tmp/sdp-ca.fp.expected /tmp/sdp-ca.fp.actual'), true)
})

await check('caScript heredoc 单引号防变量展开（CA 原样落盘）', () => {
  const c = buildJoinCommand(bundle)
  assert.equal(c.caScript.includes("<<'SDP_CA_EOF'"), true)
})

await check('verifyCommand 带期望指纹', () => {
  const c = buildJoinCommand(bundle)
  assert.equal(c.verifyCommand.includes('期望 sha256:ab12cd34'), true)
})

await check('copyText 无剪贴板环境降级返回 false（不抛异常）', () => copyText('x').then((r) => assert.equal(r, false)))

console.log(cases.join('\n'))
if (pass !== total) {
  console.error(`target-smoke: ${pass}/${total} passed`)
  process.exit(1)
}
console.log(`target-smoke: ${pass}/${total} passed`)
