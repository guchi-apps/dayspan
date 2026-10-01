#!/usr/bin/env bash
# Mac 上で YoteiFlow を Archive し、App Store Connect（TestFlight）へアップロードする（#920）。
#
#   op run --env-file=ios/asc.env.tpl -- ios/scripts/upload-testflight.sh
#
# 環境変数（必須。値は1Passwordで管理し、リポジトリへは置かない）:
#   ASC_KEY_PATH     App Store Connect API キー（.p8）のパス
#   ASC_KEY_ID       キーID
#   ASC_ISSUER_ID    Issuer ID
# 任意:
#   IOS_BUILD_NUMBER ビルド番号（既定は日時 YYYYMMDDHHMM。アップロードのたびに増えれば足りる）
#
# ビルド番号は Archive 時に上書きするだけで pbxproj は書き換えない（コミットが要らない）。
# 版番号（MARKETING_VERSION）は事前に `node ios/scripts/sync-version.mjs` で package.json に揃える。
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "このスクリプトは Mac（Xcode入り）で実行します。" >&2
  exit 1
fi
for v in ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID; do
  if [ -z "${!v:-}" ]; then
    echo "$v が未設定です。1Password の値を op run で渡してください（ios/README.md 参照）。" >&2
    exit 1
  fi
done
if [ ! -f "$ASC_KEY_PATH" ]; then
  echo "ASC_KEY_PATH のファイルがありません: $ASC_KEY_PATH" >&2
  exit 1
fi

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
ARCHIVE="$(mktemp -d)/YoteiFlow.xcarchive"

node "$IOS_DIR/scripts/check-consistency.mjs"

AUTH=(-allowProvisioningUpdates
  -authenticationKeyPath "$ASC_KEY_PATH"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID")

echo "== Archive（ビルド番号 $BUILD_NUMBER）"
xcodebuild archive \
  -project "$IOS_DIR/YoteiFlow.xcodeproj" \
  -scheme YoteiFlow \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  "${AUTH[@]}"

echo "== App Store Connect へアップロード"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$IOS_DIR/ExportOptions.plist" \
  "${AUTH[@]}"

echo "完了。App Store Connect の TestFlight で処理（数分〜）が終わるとインストールできます。"
