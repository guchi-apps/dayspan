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
    background_color: "#ffffff",
    theme_color: APP_ICON_BACKGROUND,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
