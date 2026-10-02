/**
 * iOSアプリ（WKWebView）の通知（APNs）をWebの設定画面から操作するブリッジ（issue #968）。
 *
 * WKWebViewにはPush APIが無く、通知の許可・登録はアプリ側（Swift）でしかできない。
 * 画面のスイッチはここを通してアプリへ頼み、アプリは `WKScriptMessageHandlerWithReply` で答える。
 */

import { NATIVE_PUSH_BRIDGE } from "@/lib/native-auth/native-app";

export type NativePushPermission = "notDetermined" | "denied" | "granted";

export type NativePushStatus = {
  permission: NativePushPermission;
  /** サーバーへの登録が済んでいるか（200で受けられたときだけ true）。 */
  registered: boolean;
  /** 直近の登録のHTTPステータス。未登録・通信前は null。 */
  httpStatus: number | null;
  /** 失敗の理由（アプリが返す定型の短い文）。 */
  error: string | null;
};

type Bridge = { postMessage: (message: unknown) => Promise<unknown> };

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, Bridge> } })
    .webkit?.messageHandlers;
  return handlers?.[NATIVE_PUSH_BRIDGE] ?? null;
}

/** iOSアプリの中か。ハンドラの有無で決める（UAだけでは、古いビルドのアプリで呼べないまま進んでしまう）。 */
export function isNativeApp(): boolean {
  return bridge() !== null;
}

/** アプリからの返事を、画面が扱える形へ寄せる。想定外の形は未決定・未登録として扱う。 */
export function parseNativePushStatus(value: unknown): NativePushStatus {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const permission =
    record.permission === "denied" || record.permission === "granted"
      ? record.permission
      : "notDetermined";

  return {
    permission,
    registered: record.registered === true,
    httpStatus: typeof record.httpStatus === "number" ? record.httpStatus : null,
    error: typeof record.error === "string" ? record.error : null,
  };
}

/** 登録できなかった理由を、画面に出す文にする。成功・未操作は null。 */
export function nativePushErrorMessage(status: NativePushStatus): string | null {
  if (status.registered) return null;
  if (status.permission === "denied") {
    return "通知が拒否されています。iPhoneの「設定 > 通知 > YoteiFlow」から許可してください。";
  }
  if (status.httpStatus === 503) {
    return "サーバーでAPNsの認証キーが設定されていません。";
  }
  return status.error;
}

async function call(action: "status" | "enable" | "disable"): Promise<NativePushStatus> {
  const target = bridge();
  if (!target) throw new Error("アプリの通知機能を呼べませんでした。アプリを最新にしてください。");
  return parseNativePushStatus(await target.postMessage({ action }));
}

export const nativePushStatus = () => call("status");
export const enableNativePush = () => call("enable");
export const disableNativePush = () => call("disable");
