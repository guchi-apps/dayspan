/**
 * 緯度経度の受け渡しと、タイル地図で使うWebメルカトルの変換（docs/spec.md §9）。
 *
 * 地図の位置は緯度経度で持ち、ピクセルはそのつど求める。ピクセルで持ち回ると、
 * ズームを変えるたびに保持している値を全部作り直すことになる（時間グリッドの位置を
 * 分で持ち、pxはその都度求めているのと同じ考え方）。
 */

export type LatLng = { lat: number; lng: number };

/** タイル1枚の一辺（px）。OpenStreetMapのラスタタイルは256px。 */
export const TILE_SIZE = 256;

/**
 * Webメルカトルで表せる緯度の限界。これを超えるとyが発散するため、極側はここで止める。
 */
const MAX_LATITUDE = 85.05112878;

/** 場所DBへ書く形。小数6桁あれば0.1m程度まで表せる。 */
export function formatCoordinates(point: LatLng): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

/**
 * 場所DBに入っている文字列を座標として読む。
 * 手で書いた行も混ざりうるため、数値2つとして読めないものはnullにして候補から落とす。
 */
export function parseCoordinates(text: string | null | undefined): LatLng | null {
  if (!text) return null;

  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,/\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

/**
 * 受け取った値を座標として読めるか。
 *
 * APIの本文（`{ lat, lng }`）はブラウザから来るため、形だけでなく範囲も確かめる。
 * parseCoordinates と同じ条件にして、場所DBの文字列から読んだ値と扱いを揃える。
 */
export function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/** 経度は東西でつながっている。-180〜180の範囲へ畳む。 */
export function wrapLongitude(lng: number): number {
  const wrapped = ((lng + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

/** 緯度経度 → そのズームでの世界のピクセル座標。 */
export function project(point: LatLng, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = (clampLatitude(point.lat) * Math.PI) / 180;

  return {
    x: ((point.lng + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * scale,
  };
}

/** 世界のピクセル座標 → 緯度経度。project の逆。 */
export function unproject(pixel: { x: number; y: number }, zoom: number): LatLng {
  const scale = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * pixel.y) / scale;

  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lng: wrapLongitude((pixel.x / scale) * 360 - 180),
  };
}

/** 2点がほぼ同じ地点か。住所を調べ直すかどうかの判定に使う（既定はおよそ1m）。 */
export function isSamePoint(a: LatLng, b: LatLng, tolerance = 0.00001): boolean {
  return Math.abs(a.lat - b.lat) < tolerance && Math.abs(a.lng - b.lng) < tolerance;
}
