import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

// sw.js は未ログインでも200で返す必要がある。ここを通すとログアウト時に /login への
// リダイレクトがHTMLで返り、MIMEタイプ違いで Service Worker の更新が失敗する。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
