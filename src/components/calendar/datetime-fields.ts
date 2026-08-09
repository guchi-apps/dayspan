// <input type="datetime-local"> / <input type="date"> と ISO 8601 の相互変換。
// 入力欄はタイムゾーンを持たない文字列なので、設定タイムゾーンでの壁時計として解釈する。

/** 指定タイムゾーンでの「壁時計の日時」を、その瞬間のISO 8601へ変換する。 */
export function localInputToIso(value: string, timeZone: string): string {
  // まずUTCとして解釈し、そのUTC時刻が対象タイムゾーンで何時になるかとの差を引いて補正する。
  const asUtc = new Date(`${value}:00Z`);
  const offsetMinutes = zoneOffsetMinutes(asUtc, timeZone);
  return new Date(asUtc.getTime() - offsetMinutes * 60_000).toISOString();
}

/** ISO 8601 を、指定タイムゾーンでの datetime-local 入力値（YYYY-MM-DDTHH:mm）にする。 */
export function isoToLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** そのタイムゾーンのUTCからのオフセット（分）。夏時間のある地域でも日時ごとに正しく求まる。 */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );

  return (asUtc - date.getTime()) / 60_000;
}

export function dateKeyPlusMinutes(dateKey: string, minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${dateKey}T${hour}:${minute}`;
}
