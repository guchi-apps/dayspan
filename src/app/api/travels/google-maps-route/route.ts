import { NextResponse } from "next/server";

import { analyzeGoogleMapsRoute } from "@/lib/ai-google-maps-route";
import { requireUserId } from "@/lib/auth-user";
import { isGoogleMapsHost, parseGoogleMapsRouteUrl } from "@/lib/google-maps-route";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

type RouteBody = { url?: unknown };

function validGoogleMapsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isGoogleMapsHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Googleマップの共有URLを展開する。HTML本文は読まず、許可したGoogleホストへのリダイレクトだけを追う。
 * ブラウザからはCORSで最終URLを読めないため、利用者が貼り付けた明示操作に限ってサーバーで行う。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as RouteBody;
  const value = typeof body.url === "string" ? body.url.trim() : "";
  if (!value || value.length > 2_048) {
    return NextResponse.json({ error: "invalid_request", message: "Googleマップの経路URLを入力してください。" }, { status: 400 });
  }

  let current = validGoogleMapsUrl(value);
  if (!current) {
    return NextResponse.json({ error: "invalid_request", message: "Googleマップの経路URLを貼り付けてください。" }, { status: 400 });
  }

  try {
    for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
      const parsed = parseGoogleMapsRouteUrl(current.toString());
      if (parsed) {
        const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
        if (!token) {
          return NextResponse.json(
            { error: "not_configured", message: "Googleマップ経路のAI解析が設定されていません。" },
            { status: 503 },
          );
        }
        const route = await analyzeGoogleMapsRoute(token, { ...parsed, url: current.toString() });
        return NextResponse.json({ route: { ...parsed, ...route } });
      }

      const response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (!location || response.status < 300 || response.status >= 400) break;

      const next = validGoogleMapsUrl(new URL(location, current).toString());
      if (!next) break;
      current = next;
    }
  } catch (error) {
    console.error("[dayspan] Google Maps route URL resolve failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "google_maps_request_failed", message: "Googleマップの経路を解析できませんでした。時間をおいてもう一度試してください。" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { error: "unreadable_route", message: "Googleマップの経路URLから出発地と目的地を読み取れませんでした。" },
    { status: 422 },
  );
}
