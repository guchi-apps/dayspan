import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

// sw.js は未ログインでも200で返す必要がある。ここを通すとログアウト時に /login への
// リダイレクトがHTMLで返り、MIMEタイプ違いで Service Worker の更新が失敗する。
//
// 画像拡張子の除外（`.*\.(?:svg|png|jpg|jpeg|webp)$`）は `/api/` 配下には適用しない
// （先頭に `(?!api/)` を置く）。この条件はパス全体に掛かるため、`(?!api/)` が無いと
// `/api/events/abc.png` のように動的セグメントの末尾が画像拡張子になっているAPIまで
// matcherから外れ、proxyを経由しないままルートハンドラへ届く。そのAPIが読む
// `x-dayspan-supabase-user-id`（src/lib/auth-header.ts）は proxy が上書き・削除して
// 初めて詐称されない値になるため、proxyを通らないリクエストではその保証が効かない
// （issue #839）。回帰テストは proxy.test.mts。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|apple-icon|icon|(?!api/).*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
