import type { LatLng } from "@/lib/coordinates";
import type { TransitQuota } from "@/lib/transit-quota";

/**
 * trainroute（guchi-apps/trainroute）のサーバー間参照用APIを叩く（docs/spec.md §29）。
 *
 * 電車の所要時間の取得元はNAVITIME APIだが、そのアクセスキーはDaySpanでは持たない。
 * 交通系の外部APIの窓口を trainroute に1つ置き、DaySpanもAIDEも同じ内部APIから読む。
 * キーが複数のリポジトリへ散らばると、更新のたびに配り先を数えることになる。
 *
 * **取れなかったことを失敗として投げない。** 未接続・未デプロイ・無料枠切れ・応答なしは
 * どれも「この区間は分からなかった」であって、移動そのものを作れない理由ではない。
 * 呼び出し元（/api/travels/estimate）は null を受けたら従来どおりAIの見積もりへ落ちる。
 * サーバーログには理由を全文残す（docs/spec.md §22 の「外部APIの失敗を握りつぶさない」）。
 */

/**
 * 接続先の既定値。trainroute は同じVPS上の 127.0.0.1:3112 で待ち受ける。
 *
 * ポートは1Password・secrets-manifest では管理しない（guchi-apps/docs の standards/ports.md）。
 * 開発環境で別の場所に立てたいときだけ TRAINROUTE_INTERNAL_URL で上書きする。
 */
const DEFAULT_BASE_URL = "http://127.0.0.1:3112";

/**
 * 1本あたりの制限時間。入力ダイアログのボタンから呼ばれるため、
 * 相手が遅いときに押した人を待たせ続けない（trainroute 自身の駅すぱあとクライアントと同じ値）。
 */
const TIMEOUT_MS = 5_000;

/** 一度に受け取る経路の数。ダイアログの中で候補が縦に伸びすぎない範囲に切る。 */
const DEFAULT_LIMIT = 3;

/** trainroute が返す経路1本。 */
export type TransitRoute = {
  /** 総所要時間（分）。徒歩区間を含む。 */
  minutes: number;
  /** ISO 8601。 */
  departAt: string;
  arriveAt: string;
  transitCount: number;
  /** 徒歩の合計（分）。座標がずれていないか読むために出す。 */
  walkMinutes: number;
  /** 利用する路線名。 */
  lines: string[];
  /** 実際に乗り降りした駅。渡した座標から想定と違う駅が選ばれたときに気付くために持つ。 */
  boardStation: string | null;
  alightStation: string | null;
  /** 運賃。選ぶ手掛かりとして出すだけで、DaySpanには保存しない。 */
  fare: { ticket: number; ic: number | null } | null;
};

export type TransitSearchResult = {
  routes: TransitRoute[];
  /** 提供元の表示。NAVITIMEの規約が求めるため、画面へそのまま出す。 */
  attribution: { provider: string; termsUrl: string | null } | null;
};

export type TransitSearchInput = {
  start: LatLng;
  goal: LatLng;
  /** 表示用の名前。経路の見出しを組み立てるために trainroute へ渡す。 */
  startName?: string | null;
  goalName?: string | null;
  /** 到着時刻（ISO 8601）。移動は「予定の開始までに着く」ために作るため、既定はこちら。 */
  goalTime?: string | null;
  limit?: number;
};

/** 連携が設定されているか。未設定なら画面に「調べる」経路そのものを出さない。 */
export function isTrainrouteConfigured(): boolean {
  return Boolean(process.env.TRAINROUTE_TOKEN);
}

/**
 * 2地点間の公共交通の経路を引く。取れなければ null。
 *
 * 座標で渡すのは、NAVITIMEのトータルナビがドアtoドア（最寄り駅までの徒歩を含む）で
 * 探索するため。出発地・目的地が駅である必要がなく、「自宅」に対して駅を選ばせる手順が要らない。
 */
export async function searchTransitRoutes(
  input: TransitSearchInput,
): Promise<TransitSearchResult | null> {
  const token = process.env.TRAINROUTE_TOKEN;
  if (!token) return null;

  const base = process.env.TRAINROUTE_INTERNAL_URL?.trim() || DEFAULT_BASE_URL;

  const query = new URLSearchParams({
    startLat: String(input.start.lat),
    startLon: String(input.start.lng),
    goalLat: String(input.goal.lat),
    goalLon: String(input.goal.lng),
    limit: String(input.limit ?? DEFAULT_LIMIT),
  });
  if (input.startName) query.set("startName", input.startName);
  if (input.goalName) query.set("goalName", input.goalName);
  if (input.goalTime) query.set("goalTime", input.goalTime);

  let response: Response;
  try {
    response = await fetch(`${base}/api/internal/route-transit?${query.toString()}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    // 例外にURLとトークンを載せない。ログへ出た時点で共有シークレットが経路上に残る。
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    console.error(
      `[dayspan] trainroute transit lookup failed: ${timedOut ? `no response in ${TIMEOUT_MS}ms` : "connection failed"}`,
    );
    return null;
  }

  // 404 は新APIがまだデプロイされていない、503 は trainroute 側の未設定、
  // 429 は無料枠切れ。いずれも「分からなかった」であって、断る理由にはしない。
  if (!response.ok) {
    console.error(`[dayspan] trainroute transit lookup returned HTTP ${response.status}`);
    return null;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    console.error("[dayspan] trainroute transit lookup returned a body that is not JSON");
    return null;
  }

  return normalize(json);
}

/**
 * 応答を読む。**形が合わない項目は落とし、経路そのものは通す。**
 *
 * trainroute 側は別リポジトリで、こちらの想定より項目が増えることも減ることもある。
 * 1項目の欠けで全部を失うと、所要時間が分かっているのに画面に出せない状態になる。
 */
function normalize(json: unknown): TransitSearchResult | null {
  if (typeof json !== "object" || json === null) return null;

  const rawRoutes = (json as { routes?: unknown }).routes;
  if (!Array.isArray(rawRoutes)) return null;

  const routes = rawRoutes
    .map((raw): TransitRoute | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const value = raw as Record<string, unknown>;

      const minutes = readNumber(value.minutes);
      const departAt = readString(value.departAt);
      const arriveAt = readString(value.arriveAt);
      // この3つが欠けると、押しても時刻を入れられない候補になる。
      if (minutes === null || minutes <= 0 || !departAt || !arriveAt) return null;

      return {
        minutes: Math.round(minutes),
        departAt,
        arriveAt,
        transitCount: Math.max(0, Math.round(readNumber(value.transitCount) ?? 0)),
        walkMinutes: Math.max(0, Math.round(readNumber(value.walkMinutes) ?? 0)),
        lines: Array.isArray(value.lines)
          ? value.lines.filter((line): line is string => typeof line === "string" && line !== "")
          : [],
        boardStation: readString(value.boardStation),
        alightStation: readString(value.alightStation),
        fare: readFare(value.fare),
      };
    })
    .filter((route): route is TransitRoute => route !== null);

  if (routes.length === 0) return null;

  return { routes, attribution: readAttribution((json as { attribution?: unknown }).attribution) };
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readFare(value: unknown): TransitRoute["fare"] {
  if (typeof value !== "object" || value === null) return null;
  const ticket = readNumber((value as { ticket?: unknown }).ticket);
  if (ticket === null) return null;
  return { ticket, ic: readNumber((value as { ic?: unknown }).ic) };
}

function readAttribution(value: unknown): TransitSearchResult["attribution"] {
  if (typeof value !== "object" || value === null) return null;
  const provider = readString((value as { provider?: unknown }).provider);
  if (!provider) return null;
  return { provider, termsUrl: readString((value as { termsUrl?: unknown }).termsUrl) };
}

type TransitQuotaResponse = {
  generatedAt?: unknown;
  providers?: unknown;
};

/**
 * 経路検索APIの利用枠を取る（`GET /api/internal/transit-quota`）。
 *
 * このAPI自体は外部APIを呼ばない。trainrouteが経路検索のついでに保存した残数を返すだけなので、
 * 残り回数を見るために枠を1回消費する、ということが起きない（docs/spec.md §29）。
 *
 * - 経路検索が使えない（提供元のキーが未設定・未契約）ときは空の配列が返る
 * - 取れなかったときは null。呼び出し元は区画ごと出さない
 */
export async function fetchTransitQuota(): Promise<TransitQuota[] | null> {
  const token = process.env.TRAINROUTE_TOKEN;
  // 未設定は「連携していない」であって失敗ではない。ログにも出さない。
  if (!token) return null;

  const base = process.env.TRAINROUTE_INTERNAL_URL?.trim() || DEFAULT_BASE_URL;

  let response: Response;
  try {
    response = await fetch(`${base}/api/internal/transit-quota`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    // 例外にURLとトークンを載せない。ログへ出た時点で共有シークレットが経路上に残る。
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    console.error(
      `[dayspan] trainroute transit-quota lookup failed: ${timedOut ? `no response in ${TIMEOUT_MS}ms` : "connection failed"}`,
    );
    return null;
  }

  // 本文は載せない。状態コードだけで、未デプロイ（404）・キー違い（401）・
  // trainroute側の未設定（503）を切り分けられる。
  if (!response.ok) {
    console.error(`[dayspan] trainroute transit-quota lookup returned HTTP ${response.status}`);
    return null;
  }

  let json: TransitQuotaResponse;
  try {
    json = (await response.json()) as TransitQuotaResponse;
  } catch {
    console.error("[dayspan] trainroute transit-quota lookup returned a body that is not JSON");
    return null;
  }

  if (!Array.isArray(json.providers)) {
    console.error("[dayspan] trainroute /api/internal/transit-quota returned an unexpected shape");
    return null;
  }

  return json.providers.map(toTransitQuota).filter((quota): quota is TransitQuota => quota !== null);
}

/**
 * 受け取った1件を検算する。trainrouteは別リポジトリで、こちらの想定より古い・新しい形が返りうる。
 * 残り回数が読めない行は、出すものが無いので落とす。
 */
function toTransitQuota(raw: unknown): TransitQuota | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const key = typeof value.key === "string" && value.key ? value.key : null;
  const remaining = readNumber(value.remaining);
  if (!key || remaining === null) return null;

  return {
    key,
    label: typeof value.label === "string" && value.label ? value.label : key,
    limit: readNumber(value.limit),
    remaining: Math.max(0, remaining),
    resetAt: readIsoString(value.resetAt),
    updatedAt: readIsoString(value.updatedAt),
    source: value.source === "local" ? "local" : "provider",
  };
}

function readIsoString(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}
