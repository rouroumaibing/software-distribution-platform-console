#!/usr/bin/env bash
# clean.sh — console 清理脚本（配合 pnpm scripts: clean / clean:deep）
#
#   pnpm clean       -> 仅删【生成物】，保留 node_modules（下载的依赖）
#   pnpm clean:deep  -> 删生成物 + 全部【下载依赖】(node_modules / .pnpm-store)
#
# 说明：一律用显式路径删除，绝不触碰源码 (src/ package.json 等)。
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 生成物目录（clean 与 clean:deep 都会删）
GEN_DIRS=(
  "$REPO_DIR/dist"
  "$REPO_DIR/.vite"
  "$REPO_DIR/coverage"
  "$REPO_DIR/.run"
  "$REPO_DIR/output"
)

echo "[clean:console] 删除生成物 (dist/.vite/coverage/.run/output) ..."
rm -rf "${GEN_DIRS[@]}"

# 散落的单文件生成物
find "$REPO_DIR" -maxdepth 2 \( \
  -name '*.tsbuildinfo' -o \
  -name 'pnpm-debug.log*' -o \
  -name '.DS_Store' \
  \) -delete 2>/dev/null

if [ "${1:-}" = "--deep" ]; then
  echo "[clean:console] 深度清理：额外删除全部下载依赖 (node_modules / .pnpm-store) ..."
  rm -rf "$REPO_DIR/node_modules"
  rm -rf "$REPO_DIR/.pnpm-store"
fi

echo "[clean:console] done."
