/**
 * 地図を開くときの中心を決める（docs/spec.md §9）。
 *
 * 地点を選び直す場面では、始める位置は**すでに登録されているもの**で決まっている。
 * 名前から引き直すと、名前を書き換えている途中の文字列で別の地点が中心になり、
 * そのまま「この地点にする」を押した操作が座標を黙って動かす（issue #452 / #464）。
 *
 * 見る順は `resolveYahooPlace()`（`yahoo-transit-link.ts`）と同じで、場所DB（座標 → 住所）→
 * 分けた住所 → 丸ごと。画面の中の非公開関数にしないのは、確かめるときに写しを書くことに
 * なるため（`resolveYahooPlace()` を切り出したのと同じ理由）。
 */

import type { PlaceItem } from "@/services/notion/places";

import type { LatLng } from "./coordinates";
import { matchPlaceByText, splitNameAndAddress } from "./place-text";

/**
 * 地図を開いたときの始まり方。
 *
 * `center` が決まっていれば取得の往復は要らない。決まらないときだけ `search` を地名として
 * 引く（`/api/places/geocode?q=`）。どちらも無い（＝場所欄が空）ときは現在地から始める。
 */
export type MapStart = {
  center: LatLng | null;
  search: string | null;
};

/**
 * 場所欄の値から、地図を開いたときの中心を決める（docs/spec.md §9）。
 *
 * **`名前 住所` の文字列で場所DBを引けなければならない。** 候補から選んだあとの欄には
 * この形が入る（`toLocationText`）ため、名前の完全一致だけで照合すると、登録済みの座標を
 * 持つ場所を選んでいるのに中心へ使えない（issue #464）。住所が古くなって完全一致が
 * 外れた値も、名前の前方一致で元の1件へ戻る（`matchPlaceByText`）。
 *
 * 場所DBに当たっても座標が無いときは**住所**を引く。「自宅」「本社」のような名前では
 * 地点が引けず、登録されている住所を使わないまま前回の中心や既定の中心から始まることになる。
 */
export function resolveMapStart(
  text: string,
  places: PlaceItem[],
  initialCenter: LatLng | null = null,
): MapStart {
  // 呼び出し側が中心を決めているときは、そこから動かさない（場所の編集画面の座標）。
  if (initialCenter) return { center: initialCenter, search: null };

  const value = text.trim();
  if (!value) return { center: null, search: null };

  const place = matchPlaceByText(value, places);
  if (place) {
    if (place.coordinates) return { center: place.coordinates, search: null };
    return { center: null, search: place.address ?? place.name };
  }

  // 場所DBに1件も当たらない値（他アプリで作られた予定の場所欄など）は、住所だけを引く。
  return { center: null, search: splitNameAndAddress(value)?.address ?? value };
}
