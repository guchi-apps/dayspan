/**
 * Googleマップで共有された経路URLから、移動入力欄へ反映できる値を読む（docs/spec.md §29）。
 *
 * Google Maps URLsの経路指定と、モバイル共有で使われる`/maps/dir/`のdataパラメータを読む。
 * URL形式はGoogle側のものなので、読めない部分は推測せずnullにする。
 */

import type { TravelMode } from "@/types/calendar";

const GOOGLE_HOSTS = new Set(["google.com", "www.google.com", "maps.google.com", "maps.app.goo.gl"]);

export type GoogleMapsRoute = {
  origin: string;
  destination: string;
  mode: TravelMode;
  /** AIが共有経路の情報から補完した所要時間（分）。 */
  minutes: number;
  /** Googleマップで指定された出発日時。指定が無いときはnull。 */
  departAt: string | null;
};

/** リダイレクトを追跡してよいGoogle Mapsのホストか。 */
export function isGoogleMapsHost(hostname: string): boolean {
  return GOOGLE_HOSTS.has(hostname.toLowerCase());
}

function routeMode(value: string | null): TravelMode {
  switch (value?.toLowerCase()) {
    case "transit":
      return "PUBLIC_TRANSIT";
    case "walking":
      return "WALK";
    case "bicycling":
      return "OTHER";
    default:
      return "CAR";
  }
}

function dataMode(data: string): TravelMode | null {
  const value = /!3e([0-3])(?:!|$)/.exec(data)?.[1];
  switch (value) {
    case "0":
      return "CAR";
    case "1":
      return "OTHER";
    case "2":
      return "PUBLIC_TRANSIT";
    case "3":
      return "WALK";
    default:
      return null;
  }
}

function dataDepartAt(data: string): string | null {
  const value = /!8j(\d{10,13})(?:!|$)/.exec(data)?.[1];
  if (!value) return null;

  const timestamp = Number(value) * (value.length === 10 ? 1_000 : 1);
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100
    ? null
    : date.toISOString();
}

function place(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && decoded.length <= 500 ? decoded : null;
  } catch {
    return null;
  }
}

/** 経路URL本体を解析する。短縮URLの展開はAPIルートが担当する。 */
export function parseGoogleMapsRouteUrl(input: string): GoogleMapsRoute | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isGoogleMapsHost(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const dirIndex = segments.findIndex((segment) => segment === "dir");
  const pathOrigin = dirIndex >= 0 ? place(segments[dirIndex + 1]) : null;
  const pathDestination = dirIndex >= 0 ? place(segments[dirIndex + 2]) : null;
  const origin = place(url.searchParams.get("origin")) ?? pathOrigin;
  const destination = place(url.searchParams.get("destination")) ?? pathDestination;
  if (!origin || !destination || origin === "data=" || destination === "data=") return null;

  const data = url.searchParams.get("data") ?? url.pathname.match(/\/data=([^?]+)/)?.[1] ?? "";
  return {
    origin,
    destination,
    mode: dataMode(data) ?? routeMode(url.searchParams.get("travelmode")),
    // URL自身には所要時間が無いため、APIルートでAI解析後に入れる。
    minutes: 0,
    departAt: dataDepartAt(data),
  };
}
