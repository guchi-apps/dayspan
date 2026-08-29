/**
 * 地点から住所と施設名を決める（docs/spec.md §9）。地図ダイアログの唯一の窓口。
 *
 * 取得元が2つある。施設名と広い側の地名はNominatimの逆ジオコーディングから、番地は
 * OverpassがOSMから読む生タグから取る。Nominatimは日本の住所から街区符号
 * （`addr:block_number`）を落とすため、逆ジオコーディングだけでは「渋谷二丁目1」までしか
 * 組み立てられない（正しくは渋谷2-21-1。issue #453）。
 *
 * 2つは**並行に呼ぶ**。Overpassの結果を使うかどうかはNominatimの答え（日本かどうか）で
 * 決まるが、順に呼ぶと地図を止めてから住所が出るまでが往復2回ぶんになる。
 */

import { composeJapaneseAddress, type JapaneseAddressParts } from "./japanese-address";
import { reverseGeocode, type GeocodedPlace } from "./nominatim";
import { nearestAddressTags } from "./overpass";

/**
 * Overpassの番地を採るかどうか。
 *
 * 採るのは、Nominatimが日本と答えていて、かつOverpassが**街区符号まで**返したときだけ。
 * 街区符号が無ければ組み立てられる住所は丁目までで、Nominatimの答えより細かくならない。
 * 一方で最寄りの番地は隣の街区のものでありうるため、細かくならないなら差し替えない。
 */
function shouldUseDetailed(
  japanese: JapaneseAddressParts | null,
  detailed: JapaneseAddressParts | null,
): detailed is JapaneseAddressParts {
  if (!japanese || !detailed) return false;
  return Boolean(detailed.block?.trim() || detailed.houseNumber?.includes("-"));
}

export async function resolvePointAddress(lat: number, lng: number): Promise<GeocodedPlace> {
  const [reverse, overpass] = await Promise.allSettled([
    reverseGeocode(lat, lng),
    nearestAddressTags(lat, lng),
  ]);

  // Nominatimが落ちたときは住所も施設名も無い。ここで投げると呼び出し元が地点ごと失う。
  if (reverse.status === "rejected") throw reverse.reason;

  const place = reverse.value;
  const detailed = overpass.status === "fulfilled" ? overpass.value : null;
  if (!shouldUseDetailed(place.japanese, detailed)) return place;

  // 番地の側にしか無い部品と、Nominatimの側にしか無い部品が混ざる。広い側
  // （都道府県・市区町村）はNominatimのほうが欠けにくいため、そちらで補う。
  const merged: JapaneseAddressParts = {
    ...detailed,
    province: detailed.province ?? place.japanese?.province,
    city: detailed.city ?? place.japanese?.city,
    district: detailed.district ?? place.japanese?.district,
    suburb: detailed.suburb ?? place.japanese?.suburb,
  };

  const address = composeJapaneseAddress(merged);
  return address ? { ...place, address, japanese: merged } : place;
}
