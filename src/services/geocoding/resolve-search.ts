/**
 * 地名・住所から地点を決める（docs/spec.md §9）。地図ダイアログの地名引きの唯一の窓口。
 *
 * Nominatimの地名検索は、番地の入った日本の住所を引けない（`東京都渋谷区渋谷二丁目21-1` は
 * 該当なし。実測）。場所DBに座標が無い場所を地図で開くと、登録されている住所があるのに
 * 中心が決まらず、前回の中心や既定の中心（東京駅）から始まることになる（issue #471）。
 * 見つからなかったときだけ丁目までへ落として引き直す。
 */

import { broadenJapaneseAddress } from "./japanese-address";
import { searchPlace, type GeocodedPlace } from "./nominatim";

export async function resolveTextPlace(query: string): Promise<GeocodedPlace | null> {
  const found = await searchPlace(query);
  if (found) return found;

  // 引き直すのは形を落とせたときだけ。落とせない値で同じ問い合わせを2回出さない
  // （Nominatimは1秒に1回を超える連続呼び出しを禁じている）。
  const broadened = broadenJapaneseAddress(query);
  if (!broadened || broadened === query) return null;

  return searchPlace(broadened);
}
