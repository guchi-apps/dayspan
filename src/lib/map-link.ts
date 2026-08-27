/**
 * 予定の場所から地図のURLを組み立てる（docs/spec.md §7）。
 *
 * 押した先はGoogle Maps URLsの検索の形にする。スマートフォンではGoogleマップのアプリが
 * 入っていればアプリが開き、無ければブラウザの地図が開く。DaySpan側でアプリの有無を
 * 見分ける必要が無い。
 */

import type { LatLng } from "./coordinates";

const GOOGLE_MAPS_SEARCH = "https://www.google.com/maps/search/?api=1&query=";

/**
 * 場所を開くURL。開ける先が無ければ null（リンクにしない）。
 *
 * 座標があるときだけ座標で開く。地図から登録した場所（「自宅」のように名前だけでは
 * 地点が定まらないもの）は、文字列を検索させても別の場所が当たるため。座標が無いときは
 * 場所の文字列をそのまま検索へ渡す。DaySpanの場所欄は `名前 住所` の形で入るため、
 * 名前だけを渡すより当たりやすく、Googleカレンダーで直接入れた予定の場所も同じ経路で開ける。
 */
export function mapLink(location: string | null | undefined, coordinates: LatLng | null): string | null {
  const query = location?.trim();
  if (!query) return null;

  /*
   * 場所欄に会議のリンクを入れている予定は、地図で検索しても意味が無いためそのURLを開く。
   * http(s) だけを通すのは、`javascript:` のような文字列をそのまま href に入れないため。
   * 判定から漏れたものは下の検索へ落ちるので、開ける先が無くなるわけではない。
   */
  if (/^https?:\/\//i.test(query)) return query;

  if (coordinates) return `${GOOGLE_MAPS_SEARCH}${coordinates.lat},${coordinates.lng}`;

  return `${GOOGLE_MAPS_SEARCH}${encodeURIComponent(query)}`;
}
