/**
 * その瞬間オフラインとみなすか（issue #321）。
 *
 * `useOffline()`（next/offline）は false から始まり、ブラウザの `offline` イベントか、
 * ナビゲーション・先読み・Server Action の失敗で初めて true になる
 * （`node_modules/next/dist/client/components/offline.js`）。
 * つまり次の2つの場面では、実際にはオフラインでも false のままになる。
 *
 * - オフラインのままPWAを起動・再読み込みしたとき。ページもJSも Service Worker が
 *   返すため要求が1つも失敗せず、状態の変化も無いので `offline` イベントも起きない
 * - クライアントの素の `fetch()`（`/api/calendar` など）が失敗したとき。Next.js は
 *   自前の要求しか見ていない
 *
 * そこで `navigator.onLine` の false 側だけを足す。`navigator.onLine` は
 * 「WiFiには繋がっているが外へ出られない」状態を true と答えるため true 側は信用できないが、
 * false は端末がネットワークに繋がっていないという事実そのもので、信用できる。
 *
 * 描画には使わない。読む値がサーバーとブラウザで食い違い、ハイドレーションが一致しなくなる。
 * 押されたとき・取得に失敗したときといった、出来事の側でだけ呼ぶ。
 */
export function isOfflineNow(offline: boolean): boolean {
  if (offline) return true;

  return typeof navigator !== "undefined" && navigator.onLine === false;
}
