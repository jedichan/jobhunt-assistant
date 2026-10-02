#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 20 或更新版本，再启动看板。' >&2
  exit 1
fi
if [ ! -f preliminary_job_pool.csv ] || [ ! -f job_pool.csv ]; then
  echo '尚未初始化。请先在仓库根目录运行 python3 scripts/setup.py。' >&2
  exit 1
fi
exec node server.js
