import { NextResponse } from "next/server";

import { estimateTravel, type TravelEstimate } from "@/lib/ai-travel-estimate";
import { requireUserId } from "@/lib/auth-user";
import { isLatLng, type LatLng } from "@/lib/coordinates";
import { searchPlace } from "@/services/geocoding/nominatim";
import type { TransitQuota } from "@/lib/transit-quota";
import { fetchTransitQuota, searchTransitRoutes } from "@/services/trainroute/client";
import { toTravelEstimates } from "@/services/trainroute/estimate";
import { isTravelMode, type TravelMode } from "@/types/calendar";

/**
 * 出発地から目的地までの所要時間を調べる（docs/spec.md §29）。
 *
 * 出どころは2つあり、ここで選ぶ。画面のボタンは1つのままにして、押す手数を増やさない。
 *
 * 1. 交通手段が公共交通で、両端の座標が引けるとき → trainroute 経由でNAVITIMEの経路検索
 * 2. それ以外（座標が引けない・公共交通でない・trainrouteが答えられない） → 従来どおりAIの見積もり
 *
 * どちらも呼び出しごとに枠を消費する（NAVITIMEは月500回のハードリミット、AIはプラン枠）ため、
 * 画面側ではボタン操作からだけ呼ぶ。場所の「AIに聞く」（/api/places/suggest）と同じ扱い。
 *
 * 経路検索の残り回数も応答に添える（`quota`）。そのためだけに往復を1つ増やさないため。
 * 残数を返すのは trainroute のDBで、NAVITIMEへは行かない（docs/spec.md §29）。
 */

type EstimateBody = {
  origin?: string;
  destination?: string;
  mode?: string;
  /** 到着時刻（ISO 8601）。経路検索の基準にする。 */
  arriveAt?: string;
  /**
   * 場所DBに登録済みの座標。画面が持っている値をそのまま渡してもらう。
   * サーバー側でNotionを引き直すと、ボタンを押すたびに場所DBの全件取得が増える。
   */
  originCoordinates?: unknown;
  destinationCoordinates?: unknown;
};

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as EstimateBody;
  const origin = body.origin?.trim();
  const destination = body.destination?.trim();
  if (!origin || !destination) {
    return NextResponse.json(
      { error: "invalid_request", message: "出発地と目的地を入力してください。" },
      { status: 400 },
    );
  }

  const mode: TravelMode | null = isTravelMode(body.mode) ? body.mode : null;

  if (mode === "PUBLIC_TRANSIT") {
    const transit = await lookupTransit(body, origin, destination);
    // 残り回数は経路検索の**あと**に引く。いま使った1回が引かれた値を画面へ返すため。
    if (transit) return NextResponse.json({ ...transit, quota: await currentQuota() });
  }

  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "所要時間の見積もりが設定されていません（CLAUDE_CODE_OAUTH_TOKEN が未設定です）。",
      },
      { status: 503 },
    );
  }

  try {
    const estimates = await estimateTravel(token, { origin, destination, preferredMode: mode });
    // 残り回数を添えるのは公共交通のときだけ。徒歩や車の見積もりで「経路検索は残り◯回」と
    // 出ると、何も使っていないのに使ったように読める（枠を消費するのは公共交通の経路検索だけ）。
    return NextResponse.json({
      estimates,
      attribution: null,
      quota: mode === "PUBLIC_TRANSIT" ? await currentQuota() : null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] claude travel estimate failed:", detail);
    return NextResponse.json({ error: "ai_request_failed", message: detail }, { status: 502 });
  }
}

/**
 * 経路検索で調べる。取れなければ null（呼び出し元はAIの見積もりへ落ちる）。
 *
 * 座標が要るのは、NAVITIMEのトータルナビがドアtoドアで探索するため。出発地・目的地が
 * 駅である必要がなく、最寄り駅までの徒歩を含んだ総所要時間が返る。
 */
async function lookupTransit(
  body: EstimateBody,
  origin: string,
  destination: string,
): Promise<{ estimates: TravelEstimate[]; attribution: unknown } | null> {
  const start = await resolveCoordinates(body.originCoordinates, origin);
  if (!start) return null;

  // 場所DBに座標が無い側だけNominatimへ行く。**続けて2回叩かない。**
  // Nominatimは1秒に1回を超える連続呼び出しを禁じており、片方を場所DBで賄えたときに
  // 待つ理由も無い（docs/spec.md §9）。
  const goal = await resolveCoordinates(body.destinationCoordinates, destination, start.geocoded);
  if (!goal) return null;

  const result = await searchTransitRoutes({
    start: start.value,
    goal: goal.value,
    startName: origin,
    goalName: destination,
    goalTime: body.arriveAt ?? null,
  });
  if (!result) return null;

  return {
    estimates: toTravelEstimates(result.routes, origin, destination),
    attribution: result.attribution,
  };
}

/** 1秒に1回の制限を守るための待ち時間。Nominatimの利用規約が定めている。 */
const NOMINATIM_INTERVAL_MS = 1100;

/**
 * 座標を決める。画面から渡された場所DBの値を先に使い、無いときだけ住所から引く。
 *
 * `afterGeocode` は、直前にNominatimを叩いたかどうか。叩いていれば間隔を空けてから呼ぶ。
 */
async function resolveCoordinates(
  provided: unknown,
  query: string,
  afterGeocode = false,
): Promise<{ value: LatLng; geocoded: boolean } | null> {
  if (isLatLng(provided)) return { value: provided, geocoded: false };

  try {
    if (afterGeocode) await new Promise((resolve) => setTimeout(resolve, NOMINATIM_INTERVAL_MS));
    const place = await searchPlace(query);
    if (!place) return null;
    return { value: { lat: place.lat, lng: place.lng }, geocoded: true };
  } catch (error) {
    // 座標が引けないのは失敗ではなく「この地点では経路検索できない」。AIの見積もりへ落とす。
    console.error(
      "[dayspan] geocoding for transit lookup failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * 画面に添える経路検索の残り回数。取れなければ null（画面は何も出さない）。
 *
 * 複数の提供元が返るときは、経路検索に使うものが先頭に来る（trainroute側の契約）。
 * ここで断らないのは、残り回数が分からないことが所要時間を返せない理由にはならないため。
 */
async function currentQuota(): Promise<TransitQuota | null> {
  const quotas = await fetchTransitQuota();
  return quotas?.[0] ?? null;
}
