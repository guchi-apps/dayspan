import { createHash, randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";

/**
 * iPhoneウィジェット（Scriptable）用の読み取りトークン（docs/spec.md §28）。
 *
 * Scriptableはブラウザのログインセッションを持てず、ウィジェットの更新は利用者が
 * 操作していない時点でiOSが走らせる。Supabaseのセッションでは認証できないため、
 * このトークン1本で本人を特定する。できるのは活動記録の読み取りだけ。
 */

/** 見ただけで何のトークンか分かる接頭辞。ログや設定画面で他の値と取り違えないため。 */
const TOKEN_PREFIX = "dswgt_";

/** 乱数の長さ（バイト）。base64urlで43文字になる。 */
const TOKEN_BYTES = 32;

/**
 * トークンを発行する。すでにあれば作り直し、前のトークンはその時点で使えなくなる。
 *
 * 発行と作り直しを別の関数にしない。画面から見ればどちらも「新しい台本を作る」操作で、
 * 分けると呼び出し側が現在の有無を先に調べることになる。
 */
export async function issueWidgetToken(userId: string): Promise<string> {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const encrypted = encryptSecret(token);

  await db.widgetToken.upsert({
    where: { userId },
    create: { userId, tokenHash, token: encrypted },
    // 作り直しでは最終利用日時も消す。新しいトークンはまだ一度も使われていない。
    update: { tokenHash, token: encrypted, lastUsedAt: null },
  });

  return token;
}

export type WidgetTokenInfo = {
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * 発行済みのトークンを復号して返す。無ければ null。
 *
 * ハッシュだけを持つ方式にすると、台本をコピーできるのは発行直後の1回だけになる。
 * トークンは台本の中へ埋め込んで配るため、機種変更や台本の作り直しのたびに発行し直すと
 * 他の端末のウィジェットが黙って動かなくなる。DBにはGoogle・Notionのトークンを同じ方式で
 * 暗号化して置いており、それらより弱い読み取り専用のトークンを別方式にする理由が無い。
 */
export async function getWidgetToken(userId: string): Promise<WidgetTokenInfo | null> {
  const row = await db.widgetToken.findUnique({ where: { userId } });
  if (!row) return null;

  return {
    token: decryptSecret(row.token),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/**
 * トークンからユーザーを引く。合わなければ null。
 *
 * 引くのはハッシュ側。暗号文はIVが毎回変わるため、同じトークンでも値が一致しない。
 */
export async function resolveUserIdByWidgetToken(token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const row = await db.widgetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true },
  });
  if (!row) return null;

  // 最終利用日時の更新はウィジェットの表示を妨げない。失敗しても記録の取得は続ける。
  await db.widgetToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => null);

  return row.userId;
}

/** トークンを削除する。以後どの端末のウィジェットからも読めなくなる。 */
export async function deleteWidgetToken(userId: string): Promise<boolean> {
  const result = await db.widgetToken.deleteMany({ where: { userId } });
  return result.count > 0;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
