#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# next devは.env.localを自動読込するが、このスクリプト自身（bash）は読み込まないため明示的に読む。
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

PORT="${PORT:-3000}"

# 同一LAN上の別端末（スマホ等）からsslip.io経由でアクセスできるよう、
# Windows側のポートフォワーディングをベストエフォートで設定する（失敗してもdevサーバー起動は続行する）。
bash "$(dirname "${BASH_SOURCE[0]}")/setup-lan-access.sh" "${PORT}" || echo "警告: LANアクセス設定に失敗しました。localhostでの確認は引き続き可能です。" >&2

next dev -p "${PORT}"
