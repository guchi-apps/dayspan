import { timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";

/**
 * サーバー間参照用API（`/api/internal/*`）の認証（docs/internal-api.md）。
 *
 * 呼び出し元は同一VPS上のAIDE（`127.0.0.1`）だけを想定しており、共有シークレット1本で守る。
 * ブラウザからの利用が無いためSupabaseのセッションは見ない（このパスは src/proxy.ts が
 * Supabaseへ問い合わせずに素通しする）。
 *
 * 通過した場合は null を返す。既存ルートの `if (!userId) return ...` と同じ書き味に合わせ、
 * 呼び出し側が「返り値があればそのまま返す」だけで済むようにする。
 */
export function requireInternalApiKey(request: Request): Response | null {
  const expected = process.env.INTERNAL_API_KEY;

  // 未設定を「素通り」にはしない。設定漏れがそのまま認証なしの公開に化けるのを防ぐ。
  if (!expected) {
    return json({ error: "internal_api_not_configured" }, 503);
  }

  const header = request.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!presented || !isEqualConstantTime(presented, expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  return null;
}

/**
 * サーバー間参照APIが対象とするユーザーのIDを返す。引けなければ null。
 *
 * 利用者は1人で、そのメールアドレスは ALLOWED_GOOGLE_EMAILS として既に本番へ配布済みのため、
 * APIキーとユーザーの対応表は持たない。ただし ALLOWED_GOOGLE_EMAILS は複数を許す形式なので、
 * 2件以上あるときは「誰のデータを返すのか」が決まらない。黙って先頭を選ぶと、利用者を増やした
 * 瞬間に別人の予定を返しうるため、そのときは引けなかったものとして扱う。
 */
export async function resolveInternalUserId(): Promise<string | null> {
  const emails = (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length !== 1) return null;

  const user = await db.user.findUnique({ where: { email: emails[0] }, select: { id: true } });
  return user?.id ?? null;
}

/** 応答は経路上に残さない。認証結果も内容も、その時点の値だけが意味を持つ。 */
function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** 文字列を定数時間で比較する（長さが違うと timingSafeEqual が例外を投げるため先に弾く）。 */
function isEqualConstantTime(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
