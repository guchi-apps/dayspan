import { ICON_PNG_BASE64 } from "@/lib/brand/icon-png";

// favicon。アイコン原本（assets/brand/yoteiflow-icon.svg）から生成したPNGを返す
// （scripts/generate-brand-assets.sh）。原本は影とグラデーションを含み、ImageResponse
// （satori）では再現できないため、線画を毎回描くのではなく描画済みの画像を使う。
// 表示は32pxだが、高密度の画面向けに64pxで持つ。
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new Response(Buffer.from(ICON_PNG_BASE64, "base64"), {
    headers: { "Content-Type": contentType },
  });
}
