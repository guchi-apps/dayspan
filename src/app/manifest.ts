import type { MetadataRoute } from "next";

import { APP_ICON_BACKGROUND } from "@/lib/app-icon-glyph";
import { DEFAULT_HOME_PATH } from "@/lib/home-path";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DaySpan",
    short_name: "DaySpan",
    description: "Google CalendarとNotionタスクを統合表示するカレンダー",
    start_url: DEFAULT_HOME_PATH,
    display: "standalone",
    // OSが出す起動画面の地の色。iOSは apple-touch-startup-image が無いとき、この色と
    // アイコンから起動画面を作る。アイコンの背景と同じ紫にすると角丸の器が背景に溶け、
    // 白い図柄だけが残ってアプリ側の起動画面（docs/spec.md §33）と同じ絵になる。
    // 1色しか持てないため、ライト・ダークで変わらないこの色にする。
    background_color: APP_ICON_BACKGROUND,
    theme_color: APP_ICON_BACKGROUND,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
