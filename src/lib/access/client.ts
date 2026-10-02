import type { User } from "@supabase/supabase-js";

import {
  createAccessClient,
  parseAccessResponse,
  type AccessDecision,
  type AccessFetcher,
  type AccessSubject,
} from "@/lib/access/decision";

const TIMEOUT_MS = 5_000;

/**
 * StatusHub の判定APIを呼ぶ。`ACCESS_API_URL`（StatusHubのオリジン）と `ACCESS_APP_TOKEN`
 * （管理画面で発行したアプリ別トークン）のどちらかが無ければ、通信せず失敗として扱う
 * ＝一度も判定できないので全員拒否になる（未設定が「誰でも通す」に化けない）。
 * トークンの値はログへ出さない。
 */
const fetcher: AccessFetcher = async (body) => {
  const baseUrl = process.env.ACCESS_API_URL;
  const token = process.env.ACCESS_APP_TOKEN;
  if (!baseUrl || !token) throw new Error("ACCESS_API_URL / ACCESS_APP_TOKEN が未設定");

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/access/v1/decision`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseAccessResponse(await response.json(), body.subject !== undefined);
};

// 開発サーバーの再読み込みで状態が消えないよう globalThis に置く（instrumentation と route が同じ状態を見る）。
const globalForAccess = globalThis as unknown as { __yoteiflowAccess?: ReturnType<typeof createAccessClient> };

function client() {
  globalForAccess.__yoteiflowAccess ??= createAccessClient(fetcher, undefined, Date.now, (error) => {
    console.error("[dayspan] アクセス判定の取得に失敗:", error instanceof Error ? error.message : error);
  });
  return globalForAccess.__yoteiflowAccess;
}

/**
 * Supabase が検証したユーザーから、判定APIへ送る主体を作る。
 * メールが確認済みかは Supabase の確認時刻・Googleの email_verified から決める
 * （ブラウザの申告ではなく、サーバーが検証したセッションの値だけを使う）。
 */
export function toAccessSubject(user: Pick<User, "id" | "email" | "email_confirmed_at" | "user_metadata">): AccessSubject {
  const verified = user.user_metadata?.email_verified === true || Boolean(user.email_confirmed_at);
  return { sub: user.id, email: user.email ?? "", emailVerified: verified };
}

export async function decideAccess(subject: AccessSubject): Promise<AccessDecision> {
  return client().decide(subject);
}

export async function isUserAllowed(user: Parameters<typeof toAccessSubject>[0] | null | undefined): Promise<boolean> {
  if (!user) return false;
  return (await decideAccess(toAccessSubject(user))).allowed;
}

export async function sendAccessHeartbeat(): Promise<boolean> {
  return client().heartbeat();
}
