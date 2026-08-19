import { addDays, getFetchRange, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { requireInternalApiKey, resolveInternalUserId } from "@/lib/internal-auth";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { loadCalendarData } from "@/services/calendar/load";
import {
  buildDay,
  buildOverdueTasks,
  loadOverdueSource,
  loadSources,
} from "@/services/internal/schedule";
import type { InternalScheduleResponse } from "@/types/internal-api";

// 呼び出し元は毎回その時点の予定を読む。途中の経路に残されると、動かした予定が古いまま返る。
export const dynamic = "force-dynamic";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** 1回で返せる日数の上限。朝のブリーフィングは1日ぶんで足りるため、誤った指定を頭打ちにする。 */
const MAX_DAYS = 31;

/**
 * 期限切れタスクをどこまで遡るか（日）の既定値。0を渡せば取りにいかない。
 *
 * 遡る範囲を広げるほどNotionの応答が重くなる一方、半年前に期限が過ぎたタスクを朝に読み上げても
 * 行動は変わらない。カレンダーの取得範囲は要求された日数のままにし、この遡りぶんはNotionへの
 * 別の1回で賄う（docs/spec.md §20）。
 */
const DEFAULT_OVERDUE_DAYS = 30;

/** 遡りの上限。ここを超える指定は、朝に読む用途では意味を持たない。 */
const MAX_OVERDUE_DAYS = 90;

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
  if (dateParam && !isRealDateKey(dateParam)) {
    return json({ error: "date must be a valid date in YYYY-MM-DD format" }, 400);
  }

  const daysParam = params.get("days");
  const days = daysParam === null ? 1 : Number(daysParam);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return json({ error: `days must be an integer between 1 and ${MAX_DAYS}` }, 400);
  }

  const overdueParam = params.get("overdueDays");
  const overdueDays = overdueParam === null ? DEFAULT_OVERDUE_DAYS : Number(overdueParam);
  if (!Number.isInteger(overdueDays) || overdueDays < 0 || overdueDays > MAX_OVERDUE_DAYS) {
    return json(
      { error: `overdueDays must be an integer between 0 and ${MAX_OVERDUE_DAYS}` },
      400,
    );
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

    const lookbackFrom = toDateKey(addDays(parseDateKey(from), -overdueDays));
    const dayBeforeFrom = toDateKey(addDays(parseDateKey(from), -1));

    // 期限切れは別に取る。カレンダーの取得範囲を過去へ広げると、同じ範囲がGoogleと移動へも
    // 渡り、タスク1種類のために予定を何十日ぶんも取ることになる（docs/spec.md §20）。
    // 互いに依存しないので並行に投げる。
    //
    // loadCalendarData は Google / Notion の失敗を errors に載せて返すため、ここでは投げない。
    const [data, overdue] = await Promise.all([
      loadCalendarData(userId, getFetchRange([from, to])),
      overdueDays > 0
        ? loadOverdueSource(userId, { lookbackFrom, lastDay: dayBeforeFrom })
        : { tasks: [], errors: [] },
    ]);

    const scheduleDays = dayKeys.map((dateKey) => buildDay(utils, data, dateKey));

    const response: InternalScheduleResponse = {
      generatedAt: new Date().toISOString(),
      timeZone,
      range: { from, to },
      sources: await loadSources(userId, data),
      days: scheduleDays,
      overdueTasks: buildOverdueTasks(utils, overdue.tasks, { from, lookbackFrom }, scheduleDays),
      errors: [...data.errors, ...overdue.errors],
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

/**
 * `YYYY-MM-DD` の形をしていて、かつ実在する日付か。
 *
 * 形だけを見て通すと、2026-13-45 は日付を組み立てる段でRangeErrorになり、形式不正が
 * 「取得に失敗した（503）」として返る。2026-02-30 はもっと悪く、例外にならず3月2日へ
 * 繰り上がって、頼んだ覚えのない日の予定が黙って返る。組み立て直した文字列と突き合わせれば
 * どちらも同じ判定で弾ける。
 */
function isRealDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;

  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime())) return false;

  return toDateKey(parsed) === value;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
