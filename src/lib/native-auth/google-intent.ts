import { hashToken, randomToken, safeEqual } from "@/lib/native-auth/tokens";

/**
 * Google Calendar連携の開始intent（issue #908）。
 *
 * 既存の `/api/google/connect` はログインCookie前提だが、iOSでは認証シート（Cookieなし）で
 * Googleの同意画面を開く。ログイン済みのWKWebViewが「このユーザーの連携を始める」intentを発行し、
 * 認証シート側はそれを一度だけ使う。
 *
 * - `GET ...?intent=` のクエリにトークンが載りアクセスログに残るため、**connectの時点で使い捨てる**
 *   （有効期間も60秒。ログに残った値を後から使っても通らない）
 * - callbackは、そのconnectで作ったstate（intentに紐づく）だけを受ける。ユーザーIDはintentからしか
 *   取らないため、別ユーザーへ紐付けられない
 */

export const INTENT_TTL_MS = 60_000;
/** connect後、Googleの同意画面を操作してcallbackへ戻るまでの猶予。 */
export const STATE_TTL_MS = 10 * 60_000;

export type IntentStore = {
  create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  /** 未使用・期限内のintentを原子的に使用済みにし、stateHashを紐づけて userId を返す。 */
  start(input: {
    tokenHash: string;
    stateHash: string;
    stateExpiresAt: Date;
    now: Date;
  }): Promise<{ userId: string } | null>;
  /** stateHashに紐づくintentの現状。無ければ null。 */
  findByState(stateHash: string): Promise<{
    userId: string;
    stateExpiresAt: Date | null;
    completedAt: Date | null;
  } | null>;
  /** 未完了・期限内のものを原子的に完了にする。取れたら true。 */
  complete(stateHash: string, now: Date): Promise<boolean>;
};

export async function issueIntent(input: {
  store: IntentStore;
  userId: string;
  now: Date;
}): Promise<string> {
  const token = randomToken();
  await input.store.create({
    userId: input.userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(input.now.getTime() + INTENT_TTL_MS),
  });
  return token;
}

export type StartedIntent = { state: string };

/** connect: intentを使い捨てにして、OAuthのstateを発行する。使えなければ null。 */
export async function startIntent(input: {
  store: IntentStore;
  token: string;
  now: Date;
}): Promise<StartedIntent | null> {
  const state = randomToken();
  const started = await input.store.start({
    tokenHash: hashToken(input.token),
    stateHash: hashToken(state),
    stateExpiresAt: new Date(input.now.getTime() + STATE_TTL_MS),
    now: input.now,
  });
  return started ? { state } : null;
}

export type IntentCallbackResult =
  /** このstateはintent由来ではない → 既存（ログインCookie）の経路へ */
  | { kind: "none" }
  /** intent由来だが受けられない（state不一致・期限切れ・完了済み） */
  | { kind: "rejected" }
  | { kind: "ok"; userId: string };

/**
 * callback: intent由来のstateかを先に判定する（ログインCookieの有無では分岐しない。
 * エフェメラルではないシートやSafariにログインCookieが残っていても、intent経路に入る）。
 *
 * Cookieのstateとの一致を **完了にする前に** 確かめる。不一致で完了にしてしまうと、
 * 第三者の不正なcallbackで本人のintentを潰せてしまう。
 */
export async function completeIntent(input: {
  store: IntentStore;
  state: string | null;
  cookieState: string | null;
  now: Date;
}): Promise<IntentCallbackResult> {
  if (!input.state) return { kind: "none" };

  const stateHash = hashToken(input.state);
  const intent = await input.store.findByState(stateHash);
  if (!intent) return { kind: "none" };

  if (!input.cookieState || !safeEqual(input.state, input.cookieState)) {
    return { kind: "rejected" };
  }
  if (intent.completedAt || !intent.stateExpiresAt || intent.stateExpiresAt <= input.now) {
    return { kind: "rejected" };
  }
  if (!(await input.store.complete(stateHash, input.now))) return { kind: "rejected" };

  return { kind: "ok", userId: intent.userId };
}
