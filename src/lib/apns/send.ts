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
  return postToApns(device, JSON.stringify(buildApnsPayload(input)), {
    pushType: "alert",
    priority: 10,
    ttlSeconds: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    collapseId: options.topic,
  });
}

/**
 * ライブアクティビティの更新を送る（issue #971）。
 *
 * `apns-push-type: liveactivity` と、Bundle IDに `.push-type.liveactivity` を付けた `apns-topic` が要る。
 * `sendApns` の `options.topic` は collapse-id のため、ここへは渡さない。
 */
export async function sendLiveActivity(
  device: { token: string; environment: ApnsEnvironment },
  payload: object,
  options: { ttlSeconds?: number } = {},
): Promise<ApnsResult> {
  return postToApns(device, JSON.stringify(payload), {
    pushType: "liveactivity",
    priority: 10,
    ttlSeconds: options.ttlSeconds ?? 60 * 5,
  });
}

export type ApnsHeaderInput = {
  token: string;
  jwt: string;
  /** Bundle ID（`apns-topic` の元）。 */
  bundleId: string;
  pushType: "alert" | "liveactivity";
  priority: 5 | 10;
  expiresAt: number;
  collapseId?: string;
};

/** APNsへ送るヘッダー。純粋関数（topic と push-type の取り違えを単体で確かめるため export）。 */
export function buildApnsHeaders(input: ApnsHeaderInput): Record<string, string | number> {
  const headers: Record<string, string | number> = {
    [constants.HTTP2_HEADER_METHOD]: "POST",
    [constants.HTTP2_HEADER_PATH]: `/3/device/${input.token}`,
    authorization: `bearer ${input.jwt}`,
    "apns-topic":
      input.pushType === "liveactivity" ? `${input.bundleId}.push-type.liveactivity` : input.bundleId,
    "apns-push-type": input.pushType,
    "apns-priority": String(input.priority),
    "apns-expiration": String(input.expiresAt),
  };
  // 同じ collapse-id の通知は、まだ届いていないものが置き換わる（Web Pushの Topic と同じ用途）。
  if (input.collapseId) headers["apns-collapse-id"] = input.collapseId.slice(0, 64);
  return headers;
}

async function postToApns(
  device: { token: string; environment: ApnsEnvironment },
  body: string,
  options: {
    pushType: "alert" | "liveactivity";
    priority: 5 | 10;
    ttlSeconds: number;
    collapseId?: string;
  },
): Promise<ApnsResult> {
  let jwt: string;
  let bundleId: string;
  try {
    jwt = providerToken(Date.now());
    bundleId = getApnsConfig().topic;
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

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

    const headers = buildApnsHeaders({
      token: device.token,
      jwt,
      bundleId,
      pushType: options.pushType,
      priority: options.priority,
      expiresAt: Math.floor(Date.now() / 1000) + options.ttlSeconds,
      collapseId: options.collapseId,
    });

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
