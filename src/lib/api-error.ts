import { NextResponse } from "next/server";

/**
 * 外部API呼び出しの失敗を、原因が分かる形で返す。
 * 握りつぶすと利用者にも開発者にも「保存できませんでした」しか残らず、
 * スコープ不足なのか入力不正なのかを切り分けられなくなる。
 */
export function externalApiError(
  source: "google" | "notion",
  operation: string,
  error: unknown,
): NextResponse {
  const detail = error instanceof Error ? error.message : String(error);

  // サーバーログには全文を残す。トークンは例外メッセージに含まれない
  // （googleCalendarFetchはレスポンス本文だけを載せている）。
  console.error(`[dayspan] ${source} ${operation} failed:`, detail);

  return NextResponse.json(
    { error: `${source}_request_failed`, message: summarize(detail) },
    { status: 502 },
  );
}

/** Google / Notion のエラー本文はJSONで長い。利用者に見せる1文へ縮める。 */
function summarize(detail: string): string {
  const match = detail.match(/"message"\s*:\s*"([^"]+)"/);
  if (match) return match[1];

  const statusMatch = detail.match(/returned (\d{3})/);
  if (statusMatch) return `外部APIが ${statusMatch[1]} を返しました。`;

  return detail.slice(0, 200);
}
