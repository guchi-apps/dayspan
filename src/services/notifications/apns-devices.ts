import { db } from "@/lib/db";
import type { ApnsEnvironment } from "@/lib/apns/send";

/**
 * iOSアプリの通知の送信先（APNsのデバイストークン）の出し入れ（docs/spec.md §32）。
 */

export type ApnsDeviceInput = {
  token: string;
  environment: ApnsEnvironment;
  userAgent?: string | null;
};

/** 16進のデバイストークン。長さはAppleが変えうる（現状32バイト＝64文字）ため幅を持たせる。 */
export function isValidApnsToken(token: string): boolean {
  return /^[0-9a-fA-F]{32,200}$/.test(token);
}

export async function saveApnsDevice(userId: string, input: ApnsDeviceInput): Promise<void> {
  const token = input.token.toLowerCase();
  const label = deviceLabel(input.userAgent);

  // 同じ端末で別のアカウントへ入り直したときは、同じトークンの持ち主を書き換える。
  // 前の利用者の登録が残ったままだと、その端末へ別人の予定が届く（PushSubscriptionと同じ）。
  await db.apnsDevice.upsert({
    where: { token },
    create: { userId, token, environment: input.environment, label },
    update: { userId, environment: input.environment, label, lastFailureAt: null },
  });
}

export async function deleteApnsDevice(userId: string, token: string): Promise<boolean> {
  const result = await db.apnsDevice.deleteMany({
    where: { userId, token: token.toLowerCase() },
  });
  return result.count > 0;
}

export async function countApnsDevices(userId: string): Promise<number> {
  return db.apnsDevice.count({ where: { userId } });
}

function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  return null;
}
