import { isApnsConfigured } from "@/lib/apns/config";
import { isApnsEnvironment, sendLiveActivity, type ApnsResult } from "@/lib/apns/send";
import {
  buildLiveActivityPayload,
  planLiveActivity,
  type LiveActivityChange,
} from "@/lib/live-activity/payload";
import { db } from "@/lib/db";

/**
 * 記録の開始・切り替え・停止・開始時刻の修正を、iOSアプリのライブアクティビティへ伝える（issue #971）。
 *
 * 呼び出し元（記録を変える全ての経路）から同じこの1関数を呼ぶ。サービス（running.ts）の中に
 * 置かないのは、`startActivity()` が内部で停止を呼ぶため、そこへ置くと切り替えで end と start が
 * 別々に飛ぶため。ベストエフォートで、失敗しても記録そのものは成功のまま（例外を投げない）。
 */
export async function notifyLiveActivity(
  userId: string,
  change: LiveActivityChange,
): Promise<void> {
  try {
    if (!isApnsConfigured()) return;

    const tokenRows = await db.liveActivityToken.findMany({ where: { userId } });
    const plan = planLiveActivity(change, tokenRows.length > 0);
    const running = change.type === "stopped" ? null : change.running;
    const payload = buildLiveActivityPayload(plan, running, Math.floor(Date.now() / 1000));

    const targets =
      plan === "start"
        ? await db.liveActivityDevice.findMany({ where: { userId } })
        : tokenRows;

    await Promise.all(
      targets
        .filter((target) => isApnsEnvironment(target.environment))
        .map(async (target) => {
          const result: ApnsResult = await sendLiveActivity(
            { token: target.token, environment: target.environment as "sandbox" | "production" },
            payload,
          );
          if (result.status === "gone") {
            // 失効（終了済みのアクティビティなど）は消す。次の記録ではpush-to-startで始まる。
            await (plan === "start"
              ? db.liveActivityDevice.deleteMany({ where: { id: target.id } })
              : db.liveActivityToken.deleteMany({ where: { id: target.id } })
            ).catch(() => null);
          } else if (result.status === "failed") {
            console.error("[dayspan] live activity push failed:", result.reason);
          }
        }),
    );

    // 終わったアクティビティのトークンはもう使えない。残すと次の記録でupdateの宛先になり得る。
    if (change.type === "stopped") {
      await db.liveActivityToken.deleteMany({ where: { userId } }).catch(() => null);
    }
  } catch (error) {
    console.error("[dayspan] live activity notify failed:", error);
  }
}
