import { timingSafeEqual } from "node:crypto";

/**
 * ops-dashboard が各アプリの読み取り口を呼ぶときの `Authorization: Bearer <OPS_API_TOKEN>` を検証する
 * （issue #680）。ダッシュボード側と同じ値を持ち、ほかのアプリの読み取り口と同じ検証をする。
 *
 * `secret` が未設定・空のときは、ヘッダーが何であっても拒否する（空文字同士の一致を通さない）。
 * サーバー間参照用の `requireInternalApiKey()`（`internal-auth.ts`）は未設定を503で返すが、
 * こちらは呼び出し元（ops-dashboard）との取り決めどおり未設定も不一致と同じ401にする。
 * DBを読み込む `internal-auth.ts` と分けているのは、この判定を `node --test` で単体に動かすため。
 */
export function isOpsApiAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined = process.env.OPS_API_TOKEN,
): boolean {
  if (!secret) return false;

  const prefix = "Bearer ";
  if (!authorizationHeader || !authorizationHeader.startsWith(prefix)) return false;

  const given = Buffer.from(authorizationHeader.slice(prefix.length));
  const expected = Buffer.from(secret);
  // timingSafeEqual は長さが違うと例外を投げるため、先に長さで弾く
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
