import type { TravelEstimate } from "@/lib/ai-travel-estimate";

import type { TransitRoute } from "./client";

/**
 * 経路検索の結果を、所要時間の候補（画面が並べる形）へ直す（docs/spec.md §29）。
 *
 * AIの見積もりと同じ `TravelEstimate` に揃えるのは、候補の一覧・押したときの処理を
 * 出どころの数だけ書かずに済ませるため。
 *
 * **並べ替えはしない。** どの経路を使うかはDaySpanが決めず、trainroute が返した順
 * （所要時間の短い順）のまま画面へ出して、押されたものを採る。
 */
export function toTravelEstimates(
  routes: TransitRoute[],
  origin: string,
  destination: string,
): TravelEstimate[] {
  return routes.map((route) => toTravelEstimate(route, origin, destination));
}

function toTravelEstimate(
  route: TransitRoute,
  origin: string,
  destination: string,
): TravelEstimate {
  return {
    mode: "TRAIN",
    minutes: route.minutes,
    detail: buildDetail(route, origin, destination),
    source: "transit",
    departAt: route.departAt,
    arriveAt: route.arriveAt,
    transit: {
      transitCount: route.transitCount,
      walkMinutes: route.walkMinutes,
      boardStation: route.boardStation,
      alightStation: route.alightStation,
      fare: route.fare,
    },
  };
}

/**
 * 候補の見出し。`乗った駅 → 降りた駅 ・ 路線名` の形にする。
 *
 * 駅名を先に置くのは、渡しているのが座標だから。座標がずれていれば別の駅が選ばれるため、
 * 数字を信じる前にそこで気付けるようにしておく。駅名が返らなかったときだけ、
 * 入力された出発地・目的地で代える（何の区間かが読めないままにしない）。
 */
function buildDetail(route: TransitRoute, origin: string, destination: string): string {
  const stations =
    route.boardStation && route.alightStation
      ? `${route.boardStation} → ${route.alightStation}`
      : `${origin} → ${destination}`;

  return route.lines.length > 0 ? `${stations} ・ ${route.lines.join(" → ")}` : stations;
}
