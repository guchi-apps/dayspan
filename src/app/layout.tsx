import type { Metadata, Viewport } from "next";

import "./globals.css";

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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
