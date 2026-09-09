#!/bin/bash
# gen-certs.sh —— 为 console 生成自签证书并预置到集群（443 ssl + ingress tls）。
# 对齐参考工程 old/go-devops/certs（CA + server 证书 -> kubectl create secret）。
# SDP 适配：SAN 覆盖 sdp-system 命名空间 svc 名 + ingress host console.local + localhost。
#
# 用法: OUTPUT_DIR=<dir> ./gen-certs.sh [namespace]   默认命名空间 sdp-system（需已 export KUBECONFIG）
# 幂等: secret 已存在则更新（kubectl apply）；证书产物落在 <OUTPUT_DIR>/console/
set -euo pipefail

NS="${1:-sdp-system}"
OUT="${OUTPUT_DIR:-$(pwd)}/console"
mkdir -p "$OUT"

echo "[certs] output: $OUT (namespace: $NS)"

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

# 3. 预置 secret（幂等；console chart: cert.secretName / ingress.tlsSecretName）
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
