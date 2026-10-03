/**
 * Yahoo!乗換案内の共有で受け取った経路のテキストから、予定に紐づかない新規の移動を作る入力を求める
 * （issue #1026・docs/spec.md §29）。iOSの共有拡張 → `/api/shortcuts/travel/import` が使う。
 *
 * 読み方は移動の入力欄への貼り付け（`applyYahooRoute`）と同じ規則: 日付は検索日を採用し、
 * 乗車駅・降車駅を出発地・目的地にし、メモは案内文を除いた生テキストをそのまま使う。
 * 画面と違い確かめる相手がいないため、検索日・発着時刻が読めなければ作らずに断る。
 */

import { localInputToIso } from "@/components/calendar/datetime-fields";
import {
  parseYahooTransitRoute,
  yahooRouteFields,
  yahooSearchedDateKey,
  yahooStationName,
} from "@/lib/yahoo-transit-route";

export type YahooTravelImport = {
  origin: string;
  destination: string;
  mode: "PUBLIC_TRANSIT";
  /** ISO 8601（設定タイムゾーンの壁時計をUTCへ直した値） */
  departAt: string;
  arriveAt: string;
  note: string;
  estimateSource: "YAHOO";
};

export type YahooTravelImportResult =
  | { ok: true; travel: YahooTravelImport }
  | { ok: false; error: "unreadable" | "no_date" | "no_stations"; message: string };

export function buildYahooTravelImport(text: string, timeZone: string): YahooTravelImportResult {
  const route = parseYahooTransitRoute(text);
  if (!route) {
    return {
      ok: false,
      error: "unreadable",
      message: "経路を読み取れませんでした。Yahoo!乗換案内の共有からコピーした文面を渡してください。",
    };
  }

  // 検索日が読めないまま今日などへ置くと、来週の移動が今日へ飛ぶ。作らずに断る。
  const baseDate = yahooSearchedDateKey(route);
  if (!baseDate) {
    return {
      ok: false,
      error: "no_date",
      message: "経路の検索日を読み取れなかったため、登録しませんでした。",
    };
  }

  const fields = yahooRouteFields(route, baseDate);
  if (!fields || !route.fromStation || !route.toStation) {
    return {
      ok: false,
      error: "no_stations",
      message: "出発駅・到着駅を読み取れなかったため、登録しませんでした。",
    };
  }

  return {
    ok: true,
    travel: {
      origin: yahooStationName(route.fromStation),
      destination: yahooStationName(route.toStation),
      mode: "PUBLIC_TRANSIT",
      departAt: localInputToIso(fields.departAt, timeZone),
      arriveAt: localInputToIso(fields.arriveAt, timeZone),
      note: route.noteText,
      estimateSource: "YAHOO",
    },
  };
}
