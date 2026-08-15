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
 * 記録の保存先に選ばれているカレンダーのID（issue #241）。
 *
 * カレンダー画面は、ここに挙がったカレンダーの予定を活動記録として描き分ける。
 * 記録は後から見返す事実で、これから動くために見る予定とは読む理由が違うため、
 * 時間グリッドでは塗りを落として描き、月表示には出さない。
 *
 * 保存先が未設定のときは空にする。未設定の記録は予定作成の既定のカレンダーへ入る
 * （running.ts の resolveActivityCalendarId）が、そこには普通の予定も混ざるため、
 * 含めると活動記録以外の予定まで薄く描かれる。
 *
 * 保存先は1つだが、画面へは配列で渡す。描き分けは「このカレンダーに入っているか」の
 * 判定で、保存先を複数持てるようにしたときも呼び出し側を変えずに済む。
 */
export async function listActivityCalendarIds(userId: string): Promise<string[]> {
  const calendarId = await getActivityCalendarId(userId);
  return calendarId ? [calendarId] : [];
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
