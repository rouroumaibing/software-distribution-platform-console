// runner 安装引导纯逻辑（ADR-0002，无 http / 无 store 依赖）—— 把 join-bundle
// 渲染成目标机上可执行的 join-command 片段。抽成 utils 是为了让 node 冒烟能
// 直接 import 源码 .ts（与 scripts/*.mjs 同一手法）。

import type { JoinBundle } from '@/api/target'

export interface JoinCommand {
  /** 写入 /etc/sdp-runner/ 的环境变量片段（target 机 systemd EnvironmentFile 格式）。 */
  envFile: string
  /** CA 信任根落盘 + 指纹自校验片段。 */
  caScript: string
  /** 一句话校验命令（kubeadm 语义：对拿到的 CA 验指纹）。 */
  verifyCommand: string
}

// join-bundle → 目标机自举物料。CA 与 URL 逐字内嵌（装机管线消费 userdata 的
// 同款形态），enrollToken 进 env 供 per-target 鉴权链消费（当前 runner 侧仍以
// GATEWAY_TOKEN 走 ADR-0001 自注册，token 字段为演进预留）。
export function buildJoinCommand(b: JoinBundle): JoinCommand {
  const envFile = [
    '# /etc/sdp-runner/sdp-runner.env（由 console join-bundle 生成，勿手改）',
    `HUB_GATEWAY_URL=${b.gatewayUrl}`,
    `SDP_HUB_BASE_URL=${b.apiBaseUrl}`,
    `SDP_ENROLL_TOKEN=${b.enrollToken}`,
    `SDP_HUB_CA_FILE=/etc/sdp-runner/ca.crt`,
    `SDP_HUB_CA_FINGERPRINT=${b.caFingerprint}`,
    `SDP_RUNNER_VERSION=${b.runnerVersion}`,
  ].join('\n')
  const caScript = [
    'install -d -m 0750 /etc/sdp-runner',
    "cat > /etc/sdp-runner/ca.crt <<'SDP_CA_EOF'",
    b.caPem.trimEnd(),
    'SDP_CA_EOF',
    `echo '${b.caFingerprint}' | awk -F'sha256:' '{print $2}' > /tmp/sdp-ca.fp.expected`,
    "openssl x509 -in /etc/sdp-runner/ca.crt -noout -fingerprint -sha256 | sed 's/^.*=//' | tr -d ':' | tr 'A-F' 'a-f' > /tmp/sdp-ca.fp.actual",
    'diff /tmp/sdp-ca.fp.expected /tmp/sdp-ca.fp.actual',
  ].join('\n')
  const verifyCommand = `openssl x509 -in /etc/sdp-runner/ca.crt -noout -fingerprint -sha256  # 期望 ${b.caFingerprint}`
  return { envFile, caScript, verifyCommand }
}

// 复制到剪贴板；无权限（http 页面 / 老浏览器）返回 false 由调用方提示手动复制。
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
