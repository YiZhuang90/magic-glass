#!/usr/bin/env bash
# 生成可直接上传到静态托管的 dist/（纯静态文件，无需构建工具）
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
cp -r index.html css js .nojekyll dist/
echo "dist/ 已生成：$(find dist -type f | wc -l) 个文件"
