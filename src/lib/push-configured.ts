import { isApnsConfigured } from "@/lib/apns/config";
import { isPushConfigured } from "@/lib/web-push/keys";

/**
 * 通知を送る手段が1つでもあるか。Web Push（VAPID鍵）かAPNs（認証キー）のどちらかが設定されていれば、
 * タイマー・下書き作成・記録中の通知は動かす。片方だけの環境（開発のworktreeなど）でも、
 * 設定されているほうへは届く。
 */
export function isAnyPushConfigured(): boolean {
  return isPushConfigured() || isApnsConfigured();
}
