#!/bin/bash
# gen-certs.sh —— 【本地联调专用】为 console 自签 TLS 证书并预置到集群。
#
# ⚠️ 定位（重要）：
#   证书 secret 在**生产环境由运维手工创建**，组件只在容器内引用它——与参考工程 old/go-devops
#   的做法一致（old: certs/ 下的证书 + 手工执行 certs/k8s-secret-create.sh 产 secret，
#   chart 只声明 secretName 挂载，部署流程不生成任何私钥）。
#   本脚本是**本地没有 PKI 时的临时兜底**：自签 CA + server 证书并 apply 两个 secret，
#   产物落在 <console>/output/certs（随 `pnpm clean` 一起清掉，不进入版本库、不进入交付包）。
#   生产请勿使用本脚本，改为手工创建下述 secret（契约见 console/README §TLS 证书）。
#
# 产出的 secret（chart 侧的引用契约，改名前先看 chart values）：
#   console-tls         generic，keys: ca.crt / server.crt / server.key  -> 挂 /etc/nginx/ssl（nginx 443）
#                       消费方: charts/.../templates/deployment.yaml (cert.secretName)
#   console-ingress-tls type tls，tls.crt / tls.key                       -> ingress 终结 TLS
#                       消费方: charts/.../templates/ingress.yaml (ingress.tlsSecretName)
#
# 用法: ./gen-certs.sh [namespace]         默认命名空间 sdp-system（需已 export KUBECONFIG）
#       ./gen-certs.sh --local-only         只生成证书文件、不接触集群（无 kubectl / 集群未启动时用）
#       证书产物目录可用 CERTS_DIR 覆盖（默认 <console>/output/certs）
# 幂等: secret 已存在则更新（kubectl apply）；CA 文件已存在则复用（保证链一致）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NS="sdp-system"
LOCAL_ONLY=""
for arg in "$@"; do
    case "$arg" in
        --local-only) LOCAL_ONLY=1 ;;
        -h|--help)    awk 'NR>1 && $0 !~ /^#/ {exit} NR>1 {print}' "$0"; exit 0 ;;
        -*)           echo "[certs] 未知参数: $arg" >&2; exit 1 ;;
        *)            NS="$arg" ;;
    esac
done
OUT="${CERTS_DIR:-$REPO_DIR/output/certs}"
mkdir -p "$OUT"

echo "[certs] output: $OUT (namespace: $NS)"
echo "[certs] 注意: 仅本地联调使用；生产请手工创建 console-tls / console-ingress-tls"

# 1. CA（不存在才生成；存在则复用，保证 secret 更新时链一致）
if [ ! -f "$OUT/ca.crt" ] || [ ! -f "$OUT/ca.key" ]; then
    echo "[certs] generating CA..."
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
        -keyout "$OUT/ca.key" -out "$OUT/ca.crt" \
        -subj "/C=CN/ST=ZJ/L=HZ/O=sdp/CN=sdp-local-ca" >/dev/null 2>&1
fi

# 2. server 证书（SAN：集群内 svc FQDN 链 + ingress host + localhost，443 与 ingress 复用）
cat > "$OUT/server-csr.conf" <<EOF
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name
prompt = no

[req_distinguished_name]
C = CN
ST = ZJ
L = HZ
O = sdp
CN = console.$NS.svc

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = console
DNS.2 = console.$NS
DNS.3 = console.$NS.svc
DNS.4 = console.$NS.svc.cluster
DNS.5 = console.$NS.svc.cluster.local
DNS.6 = console.local
DNS.7 = localhost
IP.1 = 127.0.0.1
EOF

echo "[certs] generating server key/csr/crt..."
openssl req -new -newkey rsa:2048 -nodes \
    -keyout "$OUT/server.key" -out "$OUT/server.csr" \
    -config "$OUT/server-csr.conf" >/dev/null 2>&1
openssl x509 -req -days 825 -in "$OUT/server.csr" \
    -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial \
    -extensions v3_req -extfile "$OUT/server-csr.conf" \
    -out "$OUT/server.crt" >/dev/null 2>&1
chmod 600 "$OUT"/*.key

echo "[certs] files ready: ${OUT}  (ca.crt / server.crt / server.key，私钥权限 600)"

# 3. 预置 secret（幂等；key 名必须与 chart 的 items / tls 约定一致）
if [ -n "$LOCAL_ONLY" ]; then
    echo "[certs] --local-only：跳过集群 secret，仅产出证书文件。"
    echo "        集群可用后重新执行一次不带 --local-only 的本脚本即可 apply 两个 secret；"
    echo "        或用 console/README §TLS 证书 里的 kubectl create secret 命令手工创建。"
    echo "[certs] done (local only)."
    exit 0
fi

echo "[certs] upserting k8s secrets in $NS..."
kubectl -n "$NS" create secret generic console-tls \
    --from-file=ca.crt="$OUT/ca.crt" \
    --from-file=server.crt="$OUT/server.crt" \
    --from-file=server.key="$OUT/server.key" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret tls console-ingress-tls \
    --cert "$OUT/server.crt" --key "$OUT/server.key" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "[certs] done: console-tls / console-ingress-tls ready in $NS"
