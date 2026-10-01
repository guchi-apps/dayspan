import type { PushNotificationInput } from "@/lib/web-push/payload";

/**
 * APNsへ送る本文（docs/spec.md §32）。文面はWeb Pushと共通で、入力（PushNotificationInput）も同じ。
 *
 * `path` はアプリのカスタム項目で、通知を押したときにWebViewで開く画面を決める。
 * 絶対URLにしないのは、アプリが開く先は常に自分のベースURL（AppConfig.baseURL）のため。
 * 受け取り側（Swift）は相対パスだけを開き、他のオリジンへは移らない。
 */

export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: "default";
    badge?: number;
    "thread-id"?: string;
  };
  path: string;
};

export function buildApnsPayload(input: PushNotificationInput): ApnsPayload {
  const aps: ApnsPayload["aps"] = {
    alert: { title: input.title, body: input.body },
    sound: "default",
  };

  // 0を送るとバッジが消える。null は「触らない」なので項目ごと外す（Web Pushの app_badge と同じ）。
  if (typeof input.badge === "number") aps.badge = input.badge;
  if (input.tag) aps["thread-id"] = input.tag;

  return { aps, path: input.path };
}
