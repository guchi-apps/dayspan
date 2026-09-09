import { NextResponse } from "next/server";

import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { externalApiMessage } from "@/lib/api-error";
import { db } from "@/lib/db";
import { formatSleepMinutes } from "@/lib/sleep";
import {
  ActivityCalendarNotFoundError,
  ActivityTimeRangeError,
} from "@/services/activity/running";
import { getActivityCalendarId } from "@/services/activity/settings";
import { resolveUserIdByShortcutToken } from "@/services/activity/shortcut-token";

/**
 * iPhoneショートカット用APIの認証と応答（docs/spec.md §40）。
 *
 * 認証はショートカット専用トークンのみで、Supabaseのセッションは見ない。就寝時・アラームの
 * 停止時に走るオートメーションは、利用者が操作していない時点でiOSが起こすため、ブラウザの
 * セッションを前提にできない。`/api/shortcuts/` は proxy.ts（middleware.ts）が
 * Supabaseへ問い合わせずに素通しする。
 *
 * トークンはクエリではなく `Authorization` ヘッダーで受ける。クエリだとApacheのアクセスログに
 * そのまま残り、ログを見られるだけで他人の記録を書き換えられるようになる。
 *
 * 経路が増えても認証の形は1つに保つため、ここへ集約する（`api/widget/shared.ts` と同じ立ち位置）。
 */
export async function resolveShortcutUserId(
  request: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return {
      ok: false,
      response: unauthorized(
        "トークンがありません。ショートカットの「URLの内容を取得」のヘッダに Authorization を足してください。",
      ),
    };
  }

  const userId = await resolveUserIdByShortcutToken(token);
  if (!userId) {
    return {
      ok: false,
      response: unauthorized(
        "トークンが無効です。設定のiPhoneショートカットからトークンを取り直してください。",
      ),
    };
  }

  return { ok: true, userId };
}

/**
 * ショートカットへの応答。
 *
 * **必ず日本語の `message` を添える。** ショートカットの「通知を表示」へそのまま流せると、
 * 効いているかどうかを実機で確かめられる。オートメーションは人が見ていない時点で走るため、
 * 打ち間違い・設定漏れに気付ける場所がほかに無い。
 *
 * `no-store` を付けるのは、途中の経路に残された応答が再生されると、記録していないのに
 * 「記録しました」が出るため。
 */
export function shortcutJson(body: { message: string } & Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * ショートカットの失敗の応答。HTTPのコードは分けたうえで、本文の形は成功時と揃える。
 *
 * 揃えておくと、ショートカット側は成否によらず `message` を1つ取り出して通知へ流せる。
 * 分けると、失敗したときだけ通知が空になる（＝いちばん知りたいときに何も出ない）。
 */
export function shortcutError(
  status: number,
  error: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { ok: false, error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** 利用者のタイムゾーン。時刻をそのまま返すと、通知にUTCの数字が出る。 */
export async function getShortcutTimeZone(userId: string): Promise<string> {
  const setting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });

  return setting?.timeZone ?? "Asia/Tokyo";
}

/** 通知に出す時刻（`06:45`）。日付は同じ日のことがほとんどのため出さない。 */
export function clockLabel(iso: string, timeZone: string): string {
  return isoToLocalInput(iso, timeZone).slice(11);
}

/** 通知に出す時間帯（`23:35〜06:45・7時間10分`）。 */
export function rangeLabel(
  range: { start: string; end: string },
  timeZone: string,
): string {
  const minutes = Math.round(
    (new Date(range.end).getTime() - new Date(range.start).getTime()) / 60_000,
  );

  return `${clockLabel(range.start, timeZone)}〜${clockLabel(range.end, timeZone)}・${formatSleepMinutes(minutes)}`;
}

function readBearerToken(header: string | null): string | null {
  if (!header) return null;

  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function unauthorized(message: string): NextResponse {
  return shortcutError(401, "unauthorized", message);
}

/**
 * 3経路で共通の失敗の扱い。
 *
 * 断りの理由（未来の時刻・保存先が決まらない）と外部APIの失敗を分けたうえで、どれも
 * `message` に日本語の理由が入る形へ揃える。握りつぶさず、Googleが返した文面は
 * `externalApiMessage()` がサーバーログへ全文を残す（CLAUDE.md「外部APIの扱い」）。
 */
export function shortcutFailure(operation: string, error: unknown): NextResponse {
  if (error instanceof ActivityTimeRangeError) {
    return shortcutError(400, "invalid_time", error.message);
  }
  if (error instanceof ActivityCalendarNotFoundError) {
    return shortcutError(404, "calendar_not_found", error.message);
  }

  return shortcutError(502, "google_request_failed", externalApiMessage("google", operation, error));
}

/**
 * 記録は残るが睡眠の一覧には出ない構成のときに、応答へ添える一言。
 *
 * 記録の書き出し先は `resolveActivityCalendarId()` が決め、`UiSetting.activityCalendarId` が
 * 未設定なら予定作成の既定カレンダーへ落ちる。一方 `/activity/sleep` が読むのは
 * `getActivityCalendarId()` で、未設定なら画面ごと出さない（既定のカレンダーには普通の予定も
 * 混ざり、どれが記録なのか区別できないため・docs/spec.md §39）。
 *
 * この構成では、ショートカットは成功を返すのに睡眠が一覧へ一生出てこない。押して記録する経路
 * なら記録中カードが画面に出るので気付けるが、オートメーションは人が見ていない時点で走る
 * （issue #608 計画レビューG2の指摘）。
 *
 * 断らずに一言を添えるほうを採る。予定はGoogleに残りカレンダー画面にも出るため、記録として
 * 成り立っていないわけではない。断ると、設定を1つしていないだけで記録そのものを失う。
 */
export async function sleepDestinationNote(userId: string): Promise<string> {
  const calendarId = await getActivityCalendarId(userId);
  if (calendarId) return "";

  return "（活動記録の保存先カレンダーが未指定のため、睡眠の一覧には出ません。設定 ▸ 活動記録 で選んでください）";
}
