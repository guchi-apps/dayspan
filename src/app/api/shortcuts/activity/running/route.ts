import { resolveActivityStopUserId, shortcutJson } from "@/app/api/shortcuts/shared";
import { getRunningActivity } from "@/services/activity/running";

/**
 * 記録中の項目を返す（issue #971）。アプリが起動時・前面に戻ったときに、手元のライブアクティビティと
 * 突き合わせるために読む。DBの1行を読むだけで、Google・Notionへの往復は無い
 * （`/api/widget/activity` は今日の合計のためにGoogleを読むため、起動のたびには重い）。
 */
export async function GET(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  const running = await getRunningActivity(auth.userId);
  return shortcutJson({
    ok: true,
    running: running ? { title: running.title, startedAt: running.startedAt } : null,
    message: running ? `${running.title}を記録中です。` : "記録していません。",
  });
}
