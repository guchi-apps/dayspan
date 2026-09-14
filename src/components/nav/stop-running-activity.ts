import { readErrorMessage } from "@/components/calendar/response-error";
import { closeActivityNotification } from "@/components/notifications/activity-notification";

/**
 * 記録を「押した時点で」止める最短経路（issue #629）。
 *
 * 下部ナビの長押しシート（activity-quick-sheet.tsx）と、どの画面からでも出す記録中バー
 * （running-activity-bar.tsx）で同じ処理を共有する。終了時刻を指定して止める・取り消す・
 * 開始時刻を直すといった詳しい操作は記録画面（activity-screen.tsx）に閉じたままにする。
 */
export async function stopRunningActivityNow(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const response = await fetch("/api/activities/stop", { method: "POST" });
    if (!response.ok) {
      return {
        ok: false,
        message: await readErrorMessage(response, "記録を保存できませんでした。"),
      };
    }
    // 「記録中」の通知は止めた時点で事実と違う（docs/spec.md §32）。この端末のぶんを消す。
    void closeActivityNotification();
    return { ok: true };
  } catch {
    return { ok: false, message: "記録を保存できませんでした。" };
  }
}
