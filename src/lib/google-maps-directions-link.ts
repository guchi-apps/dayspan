/**
 * 移動の出発地・目的地からGoogleマップの経路検索URLを組み立てる（docs/spec.md §29）。
 *
 * `yahoo-transit-link.ts` と同じく、開く先のURLを作るだけの関数。DaySpanがこのURLを
 * 取得することは無く、所要時間は利用者がコピーした文字列だけから読む。
 *
 * 出発・到着時刻はURLで指定できない（Google Maps URLsに項目が無い）ため、含めない。
 * 時刻はGoogleマップの画面で選ぶ。
 */

import type { PlaceItem } from "@/services/notion/places";

import { matchPlaceByText } from "./place-text";

const DIRECTIONS = "https://www.google.com/maps/dir/?api=1";

/** 場所欄の値から、Googleマップへ渡す1地点の文字列を決める。座標 → 住所 → 入力のまま。 */
export function resolveGoogleMapsPlace(text: string, places: PlaceItem[]): string | null {
  const value = text.trim();
  if (!value) return null;

  const place = matchPlaceByText(value, places);
  if (!place) return value;
  if (place.coordinates) return `${place.coordinates.lat},${place.coordinates.lng}`;
  return place.address ?? place.name;
}

/** 車ルートの検索URL。発着地のどちらかが無いときは null（リンクにしない）。 */
export function googleMapsDirectionsLink(origin: string | null, destination: string | null): string | null {
  if (!origin || !destination) return null;
  return `${DIRECTIONS}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
