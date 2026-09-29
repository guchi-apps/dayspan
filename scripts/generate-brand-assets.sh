#!/usr/bin/env bash
# assets/brand/yoteiflow-icon.svg（アイコン原本）から、配信するPNGを作り直す（issue #890）。
#
# - public/icon-192.png・icon-512.png … PWAのアイコン（purpose: any）。原本そのまま
# - public/icon-maskable-192.png・icon-maskable-512.png … purpose: maskable 用。
#   円形マスクの安全域（中心80%）へ収まるよう、原本を80%へ縮めて同じ紫で延長する
# - src/lib/brand/icon-png.ts … favicon(64px)・apple-touch-icon(180px)のPNGをbase64で持つモジュール。
#   本番の成果物には assets/ も src/ も入らず、実行時にファイルを読めないため、
#   ビルドに同梱される形にしてある
#
# 必要なもの: rsvg-convert（librsvg2-bin）。値を変えたらこのスクリプトを再実行してコミットする。
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=assets/brand/yoteiflow-icon.svg
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# maskable用: 原本の中身（外側の<svg>を除いたもの）を80%へ縮めて包み直す
{
  echo '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">'
  echo '<rect width="256" height="256" fill="#544FC1"/>'
  echo '<g transform="translate(25.6 25.6) scale(0.8)">'
  sed -e '1d' -e '$d' "$SRC"
  echo '</g></svg>'
} > "$TMP/maskable.svg"

render() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

render "$SRC" 192 public/icon-192.png
render "$SRC" 512 public/icon-512.png
render "$TMP/maskable.svg" 192 public/icon-maskable-192.png
render "$TMP/maskable.svg" 512 public/icon-maskable-512.png
render "$SRC" 64 "$TMP/icon-64.png"
render "$SRC" 180 "$TMP/apple-180.png"

{
  echo '// scripts/generate-brand-assets.sh が生成する。手で編集しない。'
  echo "export const ICON_PNG_BASE64 = \"$(base64 -w0 "$TMP/icon-64.png")\";"
  echo "export const APPLE_ICON_PNG_BASE64 = \"$(base64 -w0 "$TMP/apple-180.png")\";"
} > src/lib/brand/icon-png.ts
