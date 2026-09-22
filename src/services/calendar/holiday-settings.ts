import { db } from "@/lib/db";

/**
 * 祝日として扱うGoogleカレンダー（docs/spec.md、issue #699）。
 *
 * 「日本の祝日」等の公開カレンダーは読み取り専用（accessRole: reader）で購読されるのが
 * 通常のため、書き込み可能なカレンダーだけを集める WritableCalendar（loadWritableCalendars）
 * の枠組みには乗らない。固定のカレンダーIDをハードコードせず、設定で利用者に選ばせる
 * （利用者が別IDで祝日カレンダーを追加している場合にも対応するため）。
 *
 * 未設定なら祝日の優先表示は行わない（null は「対象カレンダーなし」を表す）。
 */
export async function getHolidayCalendarId(userId: string): Promise<string | null> {
  const setting = await db.uiSetting.findUnique({
    where: { userId },
    select: { holidayCalendarId: true },
  });

  return setting?.holidayCalendarId ?? null;
}

/**
 * 祝日として優先表示するカレンダーのID（終日エリアの並び替えで使う）。
 *
 * 保存先は1つだが、活動記録の保存先カレンダー（listActivityCalendarIds）と同じく
 * 画面へは配列で渡す。判定は「このカレンダーに入っているか」で、複数持てるようにしたときも
 * 呼び出し側を変えずに済む。
 */
export async function listHolidayCalendarIds(userId: string): Promise<string[]> {
  const calendarId = await getHolidayCalendarId(userId);
  return calendarId ? [calendarId] : [];
}

/**
 * 祝日カレンダーを変える。null を渡すと「祝日の優先表示なし」に戻す。
 *
 * そのユーザーの設定に無いカレンダーIDは受け付けない（他人のカレンダーIDを渡されても
 * 使わせないため）。表示（visible）・使用（writeEnabled）は問わない（祝日カレンダーは
 * 読み取り専用で購読されるのが通常で、使用オンにはならないため）。
 *
 * UiSetting は初回ログイン時に作られるが、無いまま画面が既定値で描かれている場合もある。
 * 更新ではなく upsert で受ける（setActivityCalendarId と同じ扱い）。
 */
export async function setHolidayCalendarId(
  userId: string,
  calendarId: string | null,
): Promise<{ ok: boolean; calendarId: string | null }> {
  if (calendarId) {
    const owned = await db.calendarSetting.findFirst({
      where: { userId, calendarId },
      select: { calendarId: true },
    });
    if (!owned) return { ok: false, calendarId: null };
  }

  const setting = await db.uiSetting.upsert({
    where: { userId },
    create: { userId, holidayCalendarId: calendarId },
    update: { holidayCalendarId: calendarId },
    select: { holidayCalendarId: true },
  });

  return { ok: true, calendarId: setting.holidayCalendarId };
}
