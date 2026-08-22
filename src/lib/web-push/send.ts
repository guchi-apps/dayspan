import { encryptPayload, type PushKeys } from "@/lib/web-push/encrypt";
import { getVapidKeys } from "@/lib/web-push/keys";
import { buildVapidAuthorization } from "@/lib/web-push/vapid";

/**
 * Web Pushの送信（RFC 8030）。
 *
 * 送り先はブラウザが購読のときに教えてくるURL（iPhoneならAppleのサーバー）。こちらは
 * VAPIDの署名を付けて、暗号化した本文をPOSTするだけでよい。
 */

export type PushTarget = PushKeys & {
  endpoint: string;
};

export type PushResult =
  | { status: "sent" }
  /** 購読が失効している（404 / 410）。呼び出し側は保存済みの購読を消す。 */
  | { status: "gone" }
  /** 送れなかった。理由はログに残す。 */
  | { status: "failed"; reason: string };

/** プッシュサーバーが端末へ届けられないときに、保持してもらう時間。 */
const DEFAULT_TTL_SECONDS = 60 * 60;

export async function sendWebPush(
  target: PushTarget,
  payload: string,
  options: {
    ttlSeconds?: number;
    topic?: string;
    urgency?: "very-low" | "low" | "normal" | "high";
  } = {},
): Promise<PushResult> {
  let body: Buffer;
  let authorization: string;

  try {
    body = encryptPayload(payload, target);
    authorization = buildVapidAuthorization(target.endpoint, getVapidKeys());
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    Urgency: options.urgency ?? "normal",
  };

  // 同じ Topic の通知は、まだ届いていないものが置き換わる（RFC 8030 §5.4）。
  // 記録の開始・切り替えのように、最後の1件だけが意味を持つ通知で使う。
  if (options.topic) headers.Topic = options.topic;

  try {
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers,
      // Buffer は大きな ArrayBuffer の一部を指していることがある。そのまま渡すと余分な範囲まで送られる。
      body: new Uint8Array(body),
    });

    if (response.ok) return { status: "sent" };

    // 端末がアプリを消した・購読をやめた。この送信先はもう使えない。
    if (response.status === 404 || response.status === 410) return { status: "gone" };

    const detail = await response.text().catch(() => "");
    return {
      status: "failed",
      reason: `push ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
