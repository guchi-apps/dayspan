import { connect, constants, type ClientHttp2Session } from "node:http2";

import { getApnsConfig } from "@/lib/apns/config";
import { buildApnsJwt } from "@/lib/apns/jwt";
import { buildApnsPayload } from "@/lib/apns/payload";
import type { PushNotificationInput } from "@/lib/web-push/payload";

/**
 * APNsへの送信（HTTP/2）。
 *
 * fetch（undici）はHTTP/2のクライアントとして使えないため、Node標準の `node:http2` を使う
 * （新しい依存を足さないため）。接続は送信のたびに開いて閉じる。通知は毎分のタイマーから
 * 数件ずつ出るだけで、接続を持ち続けるほどの頻度ではない。
 */

export type ApnsEnvironment = "sandbox" | "production";

export function isApnsEnvironment(value: unknown): value is ApnsEnvironment {
  return value === "sandbox" || value === "production";
}

const HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

export type ApnsResult =
  | { status: "sent" }
  /** トークンが失効している（410 Unregistered）か、環境違い・不正（400 BadDeviceToken）。消してよい。 */
  | { status: "gone" }
  | { status: "failed"; reason: string };

/** 送れなかった通知をAppleが保持する時間の既定（秒）。 */
const DEFAULT_TTL_SECONDS = 60 * 60;

/** トークンの使い回し。Appleは20〜60分の間での更新を求める。 */
const JWT_REUSE_MS = 50 * 60_000;
let cachedJwt: { value: string; issuedAt: number } | null = null;

function providerToken(now: number): string {
  if (cachedJwt && now - cachedJwt.issuedAt < JWT_REUSE_MS) return cachedJwt.value;
  const config = getApnsConfig();
  const value = buildApnsJwt(config, new Date(now));
  cachedJwt = { value, issuedAt: now };
  return value;
}

/** 失効扱いにする理由。環境違いのトークン（BadDeviceToken）は以後もずっと失敗するため消す。 */
const GONE_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);

export async function sendApns(
  device: { token: string; environment: ApnsEnvironment },
  input: PushNotificationInput,
  options: { topic?: string; ttlSeconds?: number } = {},
): Promise<ApnsResult> {
  let jwt: string;
  let topic: string;
  try {
    jwt = providerToken(Date.now());
    topic = getApnsConfig().topic;
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

  const body = JSON.stringify(buildApnsPayload(input));
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  return new Promise<ApnsResult>((resolve) => {
    let session: ClientHttp2Session;
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      session.close();
      resolve(result);
    };

    try {
      session = connect(HOSTS[device.environment]);
    } catch (error) {
      resolve({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    session.setTimeout(15_000, () => finish({ status: "failed", reason: "apns timeout" }));
    session.on("error", (error) => finish({ status: "failed", reason: error.message }));

    const headers: Record<string, string | number> = {
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${device.token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + ttl),
    };
    // 同じ collapse-id の通知は、まだ届いていないものが置き換わる（Web Pushの Topic と同じ用途）。
    if (options.topic) headers["apns-collapse-id"] = options.topic.slice(0, 64);

    const request = session.request(headers);
    let status = 0;
    const chunks: Buffer[] = [];
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", (error) => finish({ status: "failed", reason: error.message }));
    request.on("end", () => finish(interpretResponse(status, Buffer.concat(chunks).toString("utf8"))));
    request.end(body);
  });
}

/** APNsの応答を結果へ直す。純粋関数（単体で確かめるため export）。 */
export function interpretResponse(status: number, rawBody: string): ApnsResult {
  if (status === 200) return { status: "sent" };

  let reason = "";
  try {
    reason = (JSON.parse(rawBody) as { reason?: string }).reason ?? "";
  } catch {
    // 本文が無い・JSONでない
  }

  if (status === 410 || GONE_REASONS.has(reason)) return { status: "gone" };

  // 認証トークンの不備は使い回しているトークンを捨てて次回作り直す。
  if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") cachedJwt = null;

  return { status: "failed", reason: `apns ${status}${reason ? ` ${reason}` : ""}` };
}
