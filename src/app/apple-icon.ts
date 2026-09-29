import { APPLE_ICON_PNG_BASE64 } from "@/lib/brand/icon-png";

// ホーム画面に追加したときのアイコン。favicon と同じく、描画済みのPNGを返す
// （scripts/generate-brand-assets.sh）。ファイル名を `apple-icon` のまま保つのは、
// <link rel="apple-touch-icon"> の出力とService Workerが列挙するURL（/apple-icon）を変えないため。
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new Response(Buffer.from(APPLE_ICON_PNG_BASE64, "base64"), {
    headers: { "Content-Type": contentType },
  });
}
