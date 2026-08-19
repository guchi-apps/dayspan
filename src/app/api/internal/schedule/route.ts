import { addDays, getFetchRange, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { requireInternalApiKey, resolveInternalUserId } from "@/lib/internal-auth";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { loadCalendarData } from "@/services/calendar/load";
import { buildDay, buildOverdueTasks } from "@/services/internal/schedule";
import type { InternalScheduleResponse } from "@/types/internal-api";

// 呼び出し元は毎回その時点の予定を読む。途中の経路に残されると、動かした予定が古いまま返る。
export const dynamic = "force-dynamic";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** 1回で返せる日数の上限。朝のブリーフィングは1日ぶんで足りるため、誤った指定を頭打ちにする。 */
const MAX_DAYS = 31;

/**
 * 期限切れタスクをどこまで遡るか（日）。
 *
 * 遡る範囲を広げるほどNotionの応答が重くなる一方、半年前に期限が過ぎたタスクを朝に読み上げても
 * 行動は変わらない。取得はカレンダーの取得と同じ1回に含めるため、この幅ぶんGoogleの取得範囲も
 * 広がるが、月表示が既に前後3ヶ月ぶんを1回で取っており、それより狭い。
 */
const OVERDUE_LOOKBACK_DAYS = 30;

/**
 * サーバー間（AIDE）から、指定した日の予定・タスク・日付リマインド・移動をまとめて返す
 * （docs/internal-api.md）。
 *
 * 認証はAPIキー1本で、ログインセッションは見ない。このパスは src/proxy.ts が
 * Supabaseへ問い合わせずに素通しする。
 *
 * 日ごとの振り分けと並び順はカレンダー画面と同じ関数（createCalendarDateUtils）を通す。
 * ここで書き直すと、同じ日を画面で見たときと違う結果が返る。
 */
export async function GET(request: Request) {
  const unauthorized = requireInternalApiKey(request);
  if (unauthorized) return unauthorized;

  // 引数の検査はDBを見る前に済ませる。形式が違うだけの要求でDBへ問い合わせる理由が無い。
  const params = new URL(request.url).searchParams;

  const dateParam = params.get("date");
  if (dateParam && !DATE_KEY.test(dateParam)) {
    return json({ error: "date must be in YYYY-MM-DD format" }, 400);
  }

  const daysParam = params.get("days");
  const days = daysParam === null ? 1 : Number(daysParam);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return json({ error: `days must be an integer between 1 and ${MAX_DAYS}` }, 400);
  }

  try {
    const userId = await resolveInternalUserId();
    if (!userId) {
      // ALLOWED_GOOGLE_EMAILS が未設定・複数、あるいはそのメールのユーザーがまだログインしていない。
      return json({ error: "target_user_not_resolvable" }, 500);
    }

    // 日付の解釈は利用者の設定タイムゾーンで行う。サーバー（VPS）のローカル時刻はUTCのため、
    // ここをサーバー時計に任せると日本時間の 00:00〜09:00 が前日として返る。
    const uiSetting = await db.uiSetting.findUnique({
      where: { userId },
      select: { timeZone: true },
    });
    const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
    const utils = createCalendarDateUtils(timeZone);

    const from = dateParam ?? utils.todayKey();
    const dayKeys = Array.from({ length: days }, (_, index) =>
      toDateKey(addDays(parseDateKey(from), index)),
    );
    const to = dayKeys[dayKeys.length - 1];

    // 期限切れタスクのぶんだけ手前へ広げ、外部APIへの往復は1回のままにする。
    const lookbackFrom = toDateKey(addDays(parseDateKey(from), -OVERDUE_LOOKBACK_DAYS));

    // loadCalendarData は Google / Notion の失敗を errors に載せて返すため、ここでは投げない。
    const data = await loadCalendarData(userId, getFetchRange([lookbackFrom, to]));

    const scheduleDays = dayKeys.map((dateKey) => buildDay(utils, data, dateKey));

    const response: InternalScheduleResponse = {
      generatedAt: new Date().toISOString(),
      timeZone,
      range: { from, to },
      days: scheduleDays,
      overdueTasks: buildOverdueTasks(utils, data.tasks, { from, lookbackFrom }, scheduleDays),
      errors: data.errors,
    };

    return json(response, 200);
  } catch (error) {
    // ここへ来るのはDaySpanのDBを引けなかったときだけ（Google / Notion の失敗は errors に載る）。
    // 素通しするとNextの既定の500が本文なしで返り、呼び出し元は原因を切り分けられない。
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] internal schedule api failed:", detail);
    return json({ error: "internal_api_failed", message: detail.slice(0, 200) }, 503);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
