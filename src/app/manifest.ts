import type { MetadataRoute } from "next";

import { APP_ICON_BACKGROUND } from "@/lib/app-icon-glyph";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DaySpan",
    short_name: "DaySpan",
    description: "Google CalendarとNotionタスクを統合表示するカレンダー",
    // 起動画面は設定 ▸ 表示で選べる（`START_PATH_COOKIE`・issue #637）。ここを固定パスに
    // すると選んだ画面へ振り分けられないため、判定を挟む `/`（src/app/page.tsx）にする。
    // ホーム画面へ追加済みの端末では、この値がいつ新しく反映されるかをこちらから決められない
    // （iOS側の都合。docs/spec.md §28）。
    start_url: "/",
    display: "standalone",
    // OSが出す起動画面の地の色。iOSは apple-touch-startup-image が無いとき、この色と
    // アイコンから起動画面を作る。アイコンの背景と同じ紫にすると角丸の器が背景に溶け、
    // 白い図柄だけが残ってアプリ側の起動画面（docs/spec.md §33）と同じ絵になる。
    // 1色しか持てないため、ライト・ダークで変わらないこの色にする。
    background_color: APP_ICON_BACKGROUND,
    // テーマ色はアイコンの紫ではなく、ライトのヘッダーの色（surface-container-low）にする。
    // 紫のままだと、ステータスバーの領域でヘッダーの淡い色と混ざってにじむ（issue #696）。
    // ダークでは layout.tsx の <meta name="theme-color"> が media ごとに上書きする。
    theme_color: "#f3f3f8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
