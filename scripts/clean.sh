#!/usr/bin/env bash
# clean.sh — console 清理脚本（配合 package.json scripts: clean / clean:deep）
#
#   pnpm clean       -> 先停本地开发服务，再仅删【生成物】，保留 node_modules（下载的依赖）
#   pnpm clean:deep  -> 同上，额外删全部【下载依赖】(node_modules / .pnpm-store)
#
# 生成物落点（2026-09-15 起全部收敛到 output/，见 vite.config.ts）：
#   output/dist    vite 生产构建产物
#   output/.vite   vite 依赖预构建缓存
#   output/certs   本地自签 TLS 证书（临时测试用，生产由运维手工创建 secret）
#   output/**      `pnpm image` 的交付产物（charts/ images/ 交付包）
# 所以清理主体就是一条 rm -rf output —— 这也是"产物集中放 output/"的目的。
#
# 先停服务的原因：服务在运行时仍持有产物/pid，先停再删才不会留下孤儿进程或删到一半的状态。
# 跳过停服务：pnpm clean -- --no-stop   或   NO_STOP=1 pnpm clean
#
# 说明：一律用显式路径删除，绝不触碰源码 (src/ package.json 等)。
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

DEEP=""
NO_STOP="${NO_STOP:-}"
for arg in "$@"; do
  case "$arg" in
    --deep)    DEEP=1 ;;
    --no-stop) NO_STOP=1 ;;
    *) echo "[clean:console] 忽略未知参数: $arg" >&2 ;;
  esac
done

# 1. 先停本地开发服务（pid 文件 + 进程组 + 特征兜底）
if [ -n "$NO_STOP" ]; then
  echo "[clean:console] NO_STOP 已设置，跳过停服务。"
else
  echo "[clean:console] 停止本地开发服务 ..."
  bash "$REPO_DIR/scripts/svc.sh" stop
fi

# 2. 删生成物（主体：output/）
#    历史位置 dist/ .vite/ coverage/ 一并清理，避免旧残留长期占位
GEN_DIRS=(
  "$REPO_DIR/output"
  "$REPO_DIR/dist"
  "$REPO_DIR/.vite"
  "$REPO_DIR/coverage"
)

echo "[clean:console] 删除生成物 (output/ 及历史位置 dist/ .vite/ coverage/) ..."
rm -rf "${GEN_DIRS[@]}"

# 散落的单文件生成物
find "$REPO_DIR" -maxdepth 2 \( \
  -name '*.tsbuildinfo' -o \
  -name 'pnpm-debug.log*' -o \
  -name '.DS_Store' \
  \) -delete 2>/dev/null

# .run/ 是运行期产物（pid/日志），服务已停，一并清掉
rm -rf "$REPO_DIR/.run"

if [ -n "$DEEP" ]; then
  echo "[clean:console] 深度清理：额外删除全部下载依赖 (node_modules / .pnpm-store) ..."
  rm -rf "$REPO_DIR/node_modules"
  rm -rf "$REPO_DIR/.pnpm-store"
fi

echo "[clean:console] done."
