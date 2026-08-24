#!/usr/bin/env bash
# .github/secrets-manifest.tsv の repo 項目が、GitHub側から実際に値として届いているかを確かめる。
#
# 背景（#359）: 通知（Web Push）のVAPID鍵は、マニフェストにも docs/notifications.md にも
# 手順が書かれていたのに、1Password への登録と GitHub Secrets への同期が行われていなかった。
# 無い値は空文字としてワークフローへ渡り、deploy.yml の update_env はそれをそのまま本番の
# .env へ書く。起動に要らない値では何も落ちないため、「機能は入っているのに使えない」状態が
# 誰にも気付かれずに残る。手順を紙に書き足しても、実行したかを確かめる者がいなければ同じ抜けが起きる。
#
# gh secret list はリポジトリの管理権限が要り、Actions の GITHUB_TOKEN では引けない。
# そのため「存在するか」ではなく「渡ってきた値が空でないか」で判定する。
#
# 呼び出し側は、マニフェストの repo 項目をすべて env へ並べる。並べ忘れた項目は
# undeclared として別に報告する（判定できないまま黙って通さない）。
#
# Requires: 判定対象のKEYが環境変数として並んでいること
# Optional: MANIFEST（既定 .github/secrets-manifest.tsv）
# Outputs:  GITHUB_OUTPUT があれば missing / undeclared を書き出す。終了ステータスは常に0
set -euo pipefail

MANIFEST="${MANIFEST:-.github/secrets-manifest.tsv}"

if [[ ! -f "$MANIFEST" ]]; then
  echo "::warning::マニフェストが見つかりません: $MANIFEST"
  exit 0
fi

missing=""
undeclared=""

while IFS=$'\t' read -r key scope kind gh_name source; do
  [[ -z "${key:-}" || "$key" == \#* ]] && continue
  [[ "${scope:-}" != "repo" ]] && continue

  if [[ -z "${!key+declared}" ]]; then
    undeclared="$undeclared $key"
  elif [[ -z "${!key}" ]]; then
    missing="$missing $key"
  fi
done < "$MANIFEST"

# 値そのものは出さない。名前だけでどこを直せばよいか決まる。
if [[ -n "$missing" ]]; then
  echo "::warning::GitHub Secretsが空です:$missing（1Passwordへ入れてから Sync secrets ワークフローで同期してください）"
fi
if [[ -n "$undeclared" ]]; then
  echo "::warning::マニフェストにあるのに、このジョブのenvへ並んでいません:$undeclared（deploy.ymlのsecrets-checkジョブへ足してください）"
fi
if [[ -z "$missing" && -z "$undeclared" ]]; then
  echo "マニフェストのrepo項目はすべて値が届いています。"
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "missing=${missing# }"
    echo "undeclared=${undeclared# }"
  } >> "$GITHUB_OUTPUT"
fi
