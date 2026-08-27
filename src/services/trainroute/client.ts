// 同じVPS上で動く trainroute（guchi-apps/trainroute。ポート3112）のサーバー間参照用APIを呼ぶ。
//
// trainrouteは交通系の外部API（駅すぱあと・NAVITIME）の窓口で、DaySpanはそこへ問い合わせる側。
// UIコンポーネントから外部APIを直接叩かない（docs/spec.md §22）。
//
// 未設定・未デプロイ・応答なしは、いずれも失敗ではなく「取れなかった」として null を返す。
// 連携していないだけの状態を画面のエラーとして常駐させないため（呼び出し元は何も出さない）。

import type { TransitQuota } from "@/lib/transit-quota";

/**
 * 接続先の既定値。呼び出し元も trainroute も同じVPS上にいるため、外へ出る必要が無い。
 * ポートは1Password・`.github/secrets-manifest.tsv` では管理しない（PORTと同じ扱い）。
 */
const DEFAULT_BASE_URL = "http://127.0.0.1:3112";

/** 同一ホスト内の呼び出し。応答が返らないときに画面を待たせない。 */
const TIMEOUT_MS = 5_000;

/**
 * DaySpanから経路検索（`/api/internal/route-transit`）を呼ぶかどうか。#422 で true になる。
 *
 * 移動の入力画面に出す残り回数は、DaySpan自身がその枠を使うようになって初めて正しい。
 * まだ使っていない間に「電車はNAVITIMEの経路検索を使います」と出すと、実際にはAIの目安が
 * 出ているのに実データが出るかのように読める。設定 ▸ 移動の区画はこの定数と関係なく、
 * trainrouteが残数を返せた時点で出す（trainroute側が既に使った分を見るのが目的のため）。
 */
// 型を boolean で明示するのは、リテラル型（false）だと切り替えるまで後続が到達不能な
// コードとして扱われるため。#422 は値を true にするだけで済む。
export const TRANSIT_ESTIMATE_ENABLED: boolean = false;

type TransitQuotaResponse = {
  generatedAt?: unknown;
  providers?: unknown;
};

/**
 * 経路検索APIの利用枠を取る（`GET /api/internal/transit-quota`）。
 *
 * このAPI自体は外部APIを呼ばない。trainrouteが経路検索のついでに保存した残数を返すだけなので、
 * 残り回数を見るために枠を1回消費する、ということが起きない。
 *
 * - 経路検索が使えない（提供元のキーが未設定・未契約）ときは空の配列が返る
 * - 取れなかったときは null。呼び出し元は区画ごと出さない
 */
export async function fetchTransitQuota(): Promise<TransitQuota[] | null> {
  const body = await requestTrainroute<TransitQuotaResponse>("/api/internal/transit-quota");
  if (!body) return null;

  if (!Array.isArray(body.providers)) {
    console.error("[dayspan] trainroute /api/internal/transit-quota returned an unexpected shape");
    return null;
  }

  return body.providers
    .map(toTransitQuota)
    .filter((quota): quota is TransitQuota => quota !== null);
}

async function requestTrainroute<T>(path: string): Promise<T | null> {
  const token = process.env.TRAINROUTE_TOKEN;
  // 未設定は「連携していない」であって失敗ではない。ログにも出さない。
  if (!token) return null;

  const baseUrl = process.env.TRAINROUTE_INTERNAL_URL || DEFAULT_BASE_URL;

  let url: URL;
  try {
    url = new URL(path, baseUrl);
  } catch {
    // 例外メッセージには不正だった値そのものが載るため、そのままは出さない。
    console.error("[dayspan] trainroute の接続先（TRAINROUTE_INTERNAL_URL）がURLとして読めません。");
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 本文は載せない。状態コードだけで、未デプロイ（404）・キー違い（401）・
      // trainroute側の未設定（503）を切り分けられる。
      console.error(`[dayspan] trainroute ${path} returned ${response.status}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    // fetchの例外は "fetch failed" / タイムアウトの文言で、トークンもURLも含まない。
    console.error(`[dayspan] trainroute ${path} failed:`, describeError(error));
    return null;
  }
}

/**
 * 受け取った1件を検算する。trainrouteは別リポジトリで、こちらの想定より古い・新しい形が返りうる。
 * 残り回数が読めない行は、出すものが無いので落とす。
 */
function toTransitQuota(raw: unknown): TransitQuota | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const key = typeof value.key === "string" && value.key ? value.key : null;
  const remaining = toFiniteNumber(value.remaining);
  if (!key || remaining === null) return null;

  return {
    key,
    label: typeof value.label === "string" && value.label ? value.label : key,
    limit: toFiniteNumber(value.limit),
    remaining: Math.max(0, remaining),
    resetAt: toIsoString(value.resetAt),
    updatedAt: toIsoString(value.updatedAt),
    source: value.source === "local" ? "local" : "provider",
  };
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIsoString(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
