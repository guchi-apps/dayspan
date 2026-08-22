"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * この端末で通知を受け取れるようにする（docs/spec.md §32）。
 *
 * 許可はブラウザが端末ごとに持つため、状態の判定も登録もクライアント側でしかできない。
 * iPhoneでは「ホーム画面に追加したDaySpan」から開いたときにしか許可を求められず、
 * Safariのタブで開いている間は Notification / PushManager そのものが無い。
 */

export type PushState = {
  /** 判定が済むまでは null。サーバーとブラウザで値が変わるため、描き分けは判定後に行う。 */
  ready: boolean;
  /** この端末で通知を扱えるか（Service Worker・Push API・通知APIがそろっているか）。 */
  supported: boolean;
  /** iPhone・iPadで、ホーム画面に追加していない状態。追加を促す理由になる。 */
  needsInstall: boolean;
  permission: NotificationPermission | null;
  subscribed: boolean;
  busy: boolean;
  error: string | null;
};

const INITIAL: PushState = {
  ready: false,
  supported: false,
  needsInstall: false,
  permission: null,
  subscribed: false,
  busy: false,
  error: null,
};

export function usePushSubscription(publicKey: string | null) {
  const [state, setState] = useState<PushState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    const detect = async () => {
      const supported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOSのホーム画面Webアプリは display-mode を返さない版があるため、旧来の印も見る。
        (navigator as Navigator & { standalone?: boolean }).standalone === true;

      let subscribed = false;
      if (supported) {
        const registration = await navigator.serviceWorker.getRegistration();
        subscribed = Boolean(await registration?.pushManager.getSubscription());
      }

      if (cancelled) return;

      setState((previous) => ({
        ...previous,
        ready: true,
        supported,
        needsInstall: isIos && !standalone,
        permission: supported ? Notification.permission : null,
        subscribed,
      }));
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (!publicKey) {
      setState((previous) => ({
        ...previous,
        error: "サーバーで通知の鍵が設定されていません。",
      }));
      return;
    }

    setState((previous) => ({ ...previous, busy: true, error: null }));

    try {
      // 許可を求めるのは押されたときだけにする。開いただけで出すと、内容が分からないまま
      // 「許可しない」を選ばれ、以後この端末では二度と求められなくなる。
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((previous) => ({
          ...previous,
          busy: false,
          permission,
          error:
            permission === "denied"
              ? "通知が拒否されています。iPhoneの「設定 > 通知 > DaySpan」から許可してください。"
              : "通知が許可されませんでした。",
        }));
        return;
      }

      // Service Workerは本番ビルドでのみ登録している（components/offline/service-worker.tsx）。
      // ready を待つと開発中は永久に返らないため、登録の有無を先に見る。
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        setState((previous) => ({
          ...previous,
          busy: false,
          permission,
          error: "この端末ではService Workerが登録されていません（開発中は登録されません）。",
        }));
        return;
      }

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // iOSは通知を出さないプッシュを認めない。既定のtrueを明示しておく。
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(publicKey),
        }));

      const response = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setState((previous) => ({
          ...previous,
          busy: false,
          permission,
          error: body?.message ?? "この端末を登録できませんでした。",
        }));
        return;
      }

      setState((previous) => ({
        ...previous,
        busy: false,
        permission,
        subscribed: true,
        error: null,
      }));
    } catch (error) {
      setState((previous) => ({
        ...previous,
        busy: false,
        error: error instanceof Error ? error.message : "この端末を登録できませんでした。",
      }));
    }
  }, [publicKey]);

  const unsubscribe = useCallback(async () => {
    setState((previous) => ({ ...previous, busy: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // サーバー側を先に消す。ブラウザ側だけ消えて登録が残ると、届かない送信先へ
        // 送り続けることになる（失効が返るまで気付けない）。
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => null);

        await subscription.unsubscribe();
      }

      // 通知の許可そのものはここでは取り消せない（ブラウザの設定で行う）。
      setState((previous) => ({ ...previous, busy: false, subscribed: false }));
    } catch (error) {
      setState((previous) => ({
        ...previous,
        busy: false,
        error: error instanceof Error ? error.message : "解除できませんでした。",
      }));
    }
  }, []);

  return { state, subscribe, unsubscribe };
}

/**
 * base64urlの公開鍵を、subscribe() が受け取るバイト列にする。
 *
 * 器を ArrayBuffer から作るのは、`Uint8Array` の型が「SharedArrayBufferかもしれない」形になり、
 * BufferSource として受け取ってもらえないため。
 */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));

  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
