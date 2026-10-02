import { closeActivityNotification } from "@/components/notifications/activity-notification";
import { submitActivityOp } from "@/lib/activity-queue/flush";

/**
 * 記録を「押した時点で」止める最短経路（issue #629）。
 *
 * 下部ナビの長押しシート（activity-quick-sheet.tsx）と、どの画面からでも出す記録中バー
 * （running-activity-bar.tsx）で同じ処理を共有する。終了時刻を指定して止める・取り消す・
 * 開始時刻を直すといった詳しい操作は記録画面（activity-screen.tsx）に閉じたままにする。
 *
 * オフラインのときは端末にためて、通信が戻ったときに同期する（issue #974）。
 * `serverRunning` は止める対象の前提条件になる（他の端末の別の記録を止めないため）。
 */
export async function stopRunningActivityNow(
  serverRunning: { title: string; startedAt: string } | null,
  offline: boolean,
): Promise<{ ok: true; queued: boolean } | { ok: false; message: string }> {
  try {
    const result = await submitActivityOp({ kind: "stop" }, serverRunning, offline);
    if (result.status === "error") return { ok: false, message: result.message };

    // 「記録中」の通知は止めた時点で事実と違う（docs/spec.md §32）。この端末のぶんを消す。
    void closeActivityNotification();
    return { ok: true, queued: result.status === "queued" };
  } catch {
    return { ok: false, message: "記録を保存できませんでした。" };
  }
}
