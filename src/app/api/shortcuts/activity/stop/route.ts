import { after } from "next/server";

import {
  resolveActivityStopUserId,
  shortcutFailure,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import { stopRunningActivity } from "@/services/activity/running";
import { notifyLiveActivity } from "@/services/live-activity/notify";

/**
 * ライブアクティビティの停止ボタンから記録を止める（issue #971）。
 *
 * ロック画面のボタン（AppIntent）は、アプリのKeychainにある停止専用トークンで呼ぶ。
 * `/api/shortcuts/` は proxy が Supabase へ問い合わせずに素通しするため、トークンだけで通る。
 * 終了時刻はサーバーの時計で決める。
 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await stopRunningActivity(auth.userId, new Date());

    after(() => notifyLiveActivity(auth.userId, { type: "stopped" }));

    if (result.status === "not_running") {
      return shortcutJson({ ok: true, status: "not_running", message: "記録していないため、何もしませんでした。" });
    }
    return shortcutJson({ ok: true, status: "saved", saved: result.range, message: "記録を止めました。" });
  } catch (error) {
    return shortcutFailure("活動記録の保存", error);
  }
}
