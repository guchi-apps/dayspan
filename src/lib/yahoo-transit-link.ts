/**
 * 移動の出発地・目的地からYahoo!乗換案内の検索URLを組み立てる（docs/spec.md §29）。
 *
 * `map-link.ts` と同じく、開く先のURLを作るだけの関数。DaySpanがこのURLを取得することは
 * 無い（結果ページの読み取りは二次利用にあたるため。§29「取得元の選定」）。
 *
 * **座標で開く。** Yahoo!乗換案内は `flatlon` / `tlatlon` に緯度経度を受け、最寄り駅までの
 * 徒歩を含んだドアtoドアで探索する。出発地・目的地が駅である必要がなく、「自宅」に対して
 * 駅を選ばせる手順が要らない。NAVITIMEのトータルナビへ座標を渡しているのと同じ理由で、
 * 座標も同じ場所DBから引く。
 */

import type { LatLng } from "./coordinates";

const SEARCH = "https://transit.yahoo.co.jp/search/result";

/** 検索の基準。1=出発時刻を指定、4=到着時刻を指定。 */
const DEPART_AT = "1";
const ARRIVE_AT = "4";

/** 地点の渡し方。座標があればそれを使い、無ければ検索語として渡す文字列だけを持つ。 */
export type YahooTransitPlace = {
  /** 画面に出る名前。座標があるときはこちらが表示名になる。 */
  name: string;
  /** 座標が無いときの検索語。住所があれば住所のほうが地点に当たりやすい。 */
  query: string;
  coordinates: LatLng | null;
};

export type YahooTransitLinkInput = {
  origin: YahooTransitPlace | null;
  destination: YahooTransitPlace | null;
  /**
   * 入力欄の形式（`YYYY-MM-DDTHH:mm`）。設定タイムゾーンでの壁時計なので、
   * そのまま分解する。ここでDateへ通すと、サーバーのローカル時刻（UTC）が混ざる。
   */
  departAt: string;
  arriveAt: string;
};

/**
 * 検索URL。出発地・目的地が揃っていなければ null（リンクにしない）。
 *
 * 基準は到着時刻にする。移動は「予定の開始までに着く」ために作るため（§29）。
 * 到着時刻が無いときだけ出発時刻で開く。
 */
export function yahooTransitLink(input: YahooTransitLinkInput): string | null {
  const origin = input.origin;
  const destination = input.destination;
  if (!origin || !destination) return null;

  const params = new URLSearchParams();
  applyPlace(params, "from", "flatlon", origin);
  applyPlace(params, "to", "tlatlon", destination);

  const arrive = splitLocalInput(input.arriveAt);
  const depart = splitLocalInput(input.departAt);
  const basis = arrive ?? depart;
  if (basis) {
    params.set("y", basis.year);
    params.set("m", basis.month);
    params.set("d", basis.day);
    params.set("hh", basis.hour);
    // 分は十の位・一の位で分かれている（Yahoo!側の指定の形）。
    params.set("m1", basis.minute.slice(0, 1));
    params.set("m2", basis.minute.slice(1, 2));
    params.set("type", arrive ? ARRIVE_AT : DEPART_AT);
  }

  return `${SEARCH}?${params.toString()}`;
}

/**
 * 1地点ぶんの指定を積む。
 *
 * 座標があるときは名前を表示名として渡し、探索は座標で行わせる。座標が無いときは
 * 検索語（住所があれば住所）をそのまま渡す。DaySpanの場所欄は `名前 住所` の形で
 * 入るため、その文字列のままでは地点が引けない。
 */
function applyPlace(
  params: URLSearchParams,
  nameKey: string,
  coordinateKey: string,
  place: YahooTransitPlace,
): void {
  if (place.coordinates) {
    params.set(nameKey, place.name);
    params.set(coordinateKey, `${place.coordinates.lat},${place.coordinates.lng}`);
    return;
  }
  params.set(nameKey, place.query);
}

/** `YYYY-MM-DDTHH:mm` を部分ごとに分ける。形が違えば null。 */
function splitLocalInput(
  value: string,
): { year: string; month: string; day: string; hour: string; minute: string } | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!matched) return null;
  return {
    year: matched[1],
    month: matched[2],
    day: matched[3],
    hour: matched[4],
    minute: matched[5],
  };
}
