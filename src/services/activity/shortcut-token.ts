import { createHash, randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";

/**
 * iPhoneショートカット（個人用オートメーション・ヘルスケア）用のトークン（docs/spec.md §40）。
 *
 * 就寝時・アラームの停止時に走るオートメーションは、利用者が操作していない時点でiOSが起こす。
 * ブラウザのログインセッションを持てないのはウィジェットと同じで、このトークン1本で本人を
 * 特定する。できるのは睡眠の記録（`/api/shortcuts/`）だけで、予定・タスクの読み書きは持たない。
 *
 * ウィジェット用トークン（`widget-token.ts`）とは分ける。あちらは台本ごと配る前提の読み取り
 * 専用の値で、書き込みを兼ねさせると漏れたときにできることが増える。読み取りと書き込みで鍵を
 * 分けるのは `INTERNAL_API_KEY` / `INTERNAL_EVENTS_API_KEY` と同じ形（docs/internal-api.md）。
 */

/** 見ただけで何のトークンか分かる接頭辞。ウィジェット用（dswgt_）と取り違えないため。 */
const TOKEN_PREFIX = "dssc_";

/** 乱数の長さ（バイト）。base64urlで43文字になる。 */
const TOKEN_BYTES = 32;

/**
 * トークンを発行する。すでにあれば作り直し、前のトークンはその時点で使えなくなる。
 *
 * 発行と作り直しを別の関数にしない。画面から見ればどちらも「新しいトークンを作る」操作で、
 * 分けると呼び出し側が現在の有無を先に調べることになる（ウィジェット用と同じ扱い）。
 */
export async function issueShortcutToken(userId: string): Promise<string> {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const encrypted = encryptSecret(token);

  await db.shortcutToken.upsert({
    where: { userId },
    create: { userId, tokenHash, token: encrypted },
    // 作り直しでは最終利用日時も消す。新しいトークンはまだ一度も使われていない。
    update: { tokenHash, token: encrypted, lastUsedAt: null },
  });

  return token;
}

export type ShortcutTokenInfo = {
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * 発行済みのトークンを復号して返す。無ければ null。
 *
 * ハッシュだけを持つ方式にすると、コピーできるのは発行直後の1回だけになる。トークンは
 * ショートカットのヘッダーへ手で貼り込むもので、機種変更やオートメーションの作り直しのたびに
 * 発行し直すと、他の端末のオートメーションが黙って動かなくなる（ウィジェット用と同じ理由）。
 */
export async function getShortcutToken(userId: string): Promise<ShortcutTokenInfo | null> {
  const row = await db.shortcutToken.findUnique({ where: { userId } });
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
export async function resolveUserIdByShortcutToken(token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const row = await db.shortcutToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true },
  });
  if (!row) return null;

  // 最終利用日時の更新は記録そのものを妨げない。失敗しても睡眠の記録は続ける。
  await db.shortcutToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => null);

  return row.userId;
}

/** トークンを削除する。以後どの端末のオートメーションからも記録できなくなる。 */
export async function deleteShortcutToken(userId: string): Promise<boolean> {
  const result = await db.shortcutToken.deleteMany({ where: { userId } });
  return result.count > 0;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
