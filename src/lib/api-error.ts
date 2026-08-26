import { NextResponse } from "next/server";

/**
 * 外部API呼び出しの失敗を、原因が分かる形で返す。
 * 握りつぶすと利用者にも開発者にも「保存できませんでした」しか残らず、
 * スコープ不足なのか入力不正なのかを切り分けられなくなる。
 */
export function externalApiError(
  source: "google" | "notion" | "osm",
  operation: string,
  error: unknown,
): NextResponse {
  return NextResponse.json(
    { error: `${source}_request_failed`, message: externalApiMessage(source, operation, error) },
    { status: 502 },
  );
}

/**
 * 失敗をサーバーログへ残し、画面に出す1文を返す。
 *
 * APIルートを通らない経路（サーバーコンポーネントの取得）でも、握りつぶさずに原因を
 * 見せられるようにするため、応答の組み立てと切り離して置く。
 */
export function externalApiMessage(
  source: "google" | "notion" | "osm",
  operation: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);

  // サーバーログには全文を残す。トークンは例外メッセージに含まれない
  // （googleCalendarFetchはレスポンス本文だけを載せている）。
  console.error(`[dayspan] ${source} ${operation} failed:`, detail);

  return summarize(detail);
}

/**
 * 書き込み先のカレンダーを引けなかったときの応答。
 * 「使用」がオフで断ったのか、そもそも見つからないのかを分けて伝える。同じ404にまとめると、
 * 設定を変えれば書けるのかどうかが画面から分からなくなる。
 */
export function calendarWriteError(reason: "not_found" | "write_disabled"): NextResponse {
  if (reason === "write_disabled") {
    return NextResponse.json(
      {
        error: "calendar_not_writable",
        message:
          "このカレンダーは使用しない設定になっています。設定のGoogle Calendarで「使用」をオンにしてください。",
      },
      { status: 403 },
    );
  }

  return NextResponse.json({ error: "calendar_not_found" }, { status: 404 });
}

/** Google / Notion のエラー本文はJSONで長い。利用者に見せる1文へ縮める。 */
function summarize(detail: string): string {
  const match = detail.match(/"message"\s*:\s*"([^"]+)"/);
  if (match) return match[1];

  const statusMatch = detail.match(/returned (\d{3})/);
  if (statusMatch) return `外部APIが ${statusMatch[1]} を返しました。`;

  return detail.slice(0, 200);
}
