import type { Metadata, Viewport } from "next";

// Noto Sans JP（M3の日本語向け標準書体）を自己ホストする。
// next/font/google はこの開発環境から fonts.gstatic.com へ到達できずビルドが失敗するため使わない。
// unicode-range で124分割されており、ブラウザは実際に使う文字のサブセットだけを取得する。
import "@fontsource-variable/noto-sans-jp";
import "./globals.css";

import { AppLaunchScreen } from "@/components/launch/app-launch-screen";
import { AppReady } from "@/components/launch/app-ready";
import { ServiceWorkerRegistration } from "@/components/offline/service-worker";

export const metadata: Metadata = {
  title: "DaySpan",
  description: "Google Calendarの予定とNotionのタスクを1つのカレンダーUIで統合して確認・操作するWebアプリ",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DaySpan",
  },
};

export const viewport: Viewport = {
  // カレンダーの時間グリッドは画面の高さいっぱいに使うため、モバイルのアドレスバー分を含む
  // 実際の表示領域（dvh）を基準にレイアウトする。
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* 起動画面は本文より先に置く。ページの描画を待つあいだにシェルだけが先に流れるため、
            ここに置いておくと最初のチャンクで描かれる（docs/spec.md §33）。 */}
        <AppLaunchScreen />
        {children}
        <AppReady />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
