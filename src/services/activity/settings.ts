import { db } from "@/lib/db";

/**
 * 活動記録の保存先カレンダー（docs/spec.md §27）。
 *
 * 保存先は項目ごとではなく、記録全体で1つ。null は「予定作成の既定の保存先へ入れる」を表す。
 */
export async function getActivityCalendarId(userId: string): Promise<string | null> {
  const setting = await db.uiSetting.findUnique({
    where: { userId },
    select: { activityCalendarId: true },
  });

  return setting?.activityCalendarId ?? null;
}

/**
 * 保存先カレンダーを変える。null を渡すと既定の保存先へ戻す。
 *
 * そのユーザーの設定に無いカレンダーIDは受け付けない（他人のカレンダーIDを渡されても
 * 書き込ませないため）。書けるかどうかの確認はGoogleへ問い合わせずカレンダー設定の行で行う。
 * 保存のたびに外部APIを叩かないためで、書けなくなっていた場合は
 * resolveActivityCalendarId が既定の保存先へ落とす。
 *
 * UiSetting は初回ログイン時に作られるが、無いまま画面が既定値で描かれている場合もある。
 * 更新ではなく upsert で受ける（/api/settings/ui と同じ扱い）。
 */
export async function setActivityCalendarId(
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
    create: { userId, activityCalendarId: calendarId },
    update: { activityCalendarId: calendarId },
    select: { activityCalendarId: true },
  });

  return { ok: true, calendarId: setting.activityCalendarId };
}
