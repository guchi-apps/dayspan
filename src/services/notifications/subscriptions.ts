import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { buildPushPayload, type PushNotificationInput } from "@/lib/web-push/payload";
import { sendWebPush } from "@/lib/web-push/send";

/**
 * 通知の送信先（端末ごと）の出し入れと、その端末たちへの送信（docs/spec.md §32）。
 *
 * 送信先URL（endpoint）はブラウザが発行するもので、長さが決まっていない。MySQLのインデックスに
 * そのまま載せられないため、引くのはSHA-256のハッシュで行う（ウィジェットのトークンと同じ作り）。
 */

export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** 通知を押したときの行き先を組み立てるアドレス。購読した端末が開いていたものを使う。 */
  origin: string;
  userAgent?: string | null;
};

export type SubscriptionSummary = {
  id: string;
  label: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
};

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export async function saveSubscription(
  userId: string,
  input: SubscriptionInput,
): Promise<SubscriptionSummary> {
  const hash = endpointHash(input.endpoint);
  const label = deviceLabel(input.userAgent);

  // 同じ端末が購読し直したときは同じendpointが返ることがある。作り直さず持ち主を書き換えるのは、
  // 前の利用者の購読が残ったままだと、その端末へ別人の予定が届くため。
  const row = await db.pushSubscription.upsert({
    where: { endpointHash: hash },
    create: {
      userId,
      endpoint: input.endpoint,
      endpointHash: hash,
      p256dh: input.p256dh,
      auth: input.auth,
      origin: input.origin,
      label,
    },
    update: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      origin: input.origin,
      label,
      lastFailureAt: null,
    },
  });

  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    lastSuccessAt: row.lastSuccessAt,
  };
}

/** 購読をやめる。押した端末のぶんだけを消す。 */
export async function deleteSubscription(userId: string, endpoint: string): Promise<boolean> {
  const result = await db.pushSubscription.deleteMany({
    where: { userId, endpointHash: endpointHash(endpoint) },
  });
  return result.count > 0;
}

export async function listSubscriptions(userId: string): Promise<SubscriptionSummary[]> {
  const rows = await db.pushSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, createdAt: true, lastSuccessAt: true },
  });
  return rows;
}

export async function countSubscriptions(userId: string): Promise<number> {
  return db.pushSubscription.count({ where: { userId } });
}

export type SendSummary = {
  sent: number;
  /** 失効していたため消した送信先の数。 */
  removed: number;
  failed: number;
};

/**
 * その利用者の全ての端末へ1件送る。
 *
 * 行き先の絶対URLは端末ごとに違いうる（本番のPWAとローカルの開発サーバー）ため、
 * ペイロードは購読ごとに組み立てる。
 */
export async function sendToUser(
  userId: string,
  input: PushNotificationInput,
  options: { topic?: string; ttlSeconds?: number } = {},
): Promise<SendSummary> {
  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  const summary: SendSummary = { sent: 0, removed: 0, failed: 0 };

  const now = new Date();

  for (const subscription of subscriptions) {
    const result = await sendWebPush(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      buildPushPayload(input, subscription.origin),
      options,
    );

    if (result.status === "sent") {
      summary.sent += 1;
      await db.pushSubscription.update({
        where: { id: subscription.id },
        data: { lastSuccessAt: now },
      });
      continue;
    }

    if (result.status === "gone") {
      // 端末がアプリを消した・購読をやめた。残すと以後ずっと失敗し続ける。
      summary.removed += 1;
      await db.pushSubscription.delete({ where: { id: subscription.id } });
      continue;
    }

    summary.failed += 1;
    console.error(`[dayspan] push failed (${subscription.label ?? "unknown"}):`, result.reason);
    await db.pushSubscription.update({
      where: { id: subscription.id },
      data: { lastFailureAt: now },
    });
  }

  return summary;
}

/**
 * 設定画面で端末を見分けるための名前。
 *
 * 複数の端末を許可したときに、どれを解除すればよいか分かる必要がある。細かく判別する必要は
 * 無いので、機種の系統だけを取り出す。
 */
function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;

  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Macintosh/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows";
  return null;
}
