"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOffline } from "next/offline";

import { isOfflineNow } from "@/components/offline/offline-state";

export type ApiResource<T> = {
  /** まだ一度も取得できていないあいだは null。 */
  data: T | null;
  /** 取得のやり直しを含め、要求が飛んでいる最中。 */
  loading: boolean;
  /** 取得に失敗した理由。オフライン中の失敗は出さない（画面に OfflineNotice が出ている）。 */
  error: string | null;
  /** 直近の取得が、通信が遅くて Service Worker が代わりに返した保存済みだったか（issue #718）。 */
  stale: boolean;
  /** 取り直す。進行中の要求があっても新しく出し、古い応答は捨てる。 */
  reload: () => void;
  /** 取得済みの内容へ手元で変更を重ねる（保存の応答を先に画面へ反映するため）。 */
  mutate: (update: (current: T) => T) => void;
};

/** サーバーが返した失敗理由。通信の失敗（TypeError など）の文言は画面へ出さない。 */
class ServerMessageError extends Error {}

/**
 * 画面の一覧を GET API から取る（issue #724）。
 *
 * 画面の枠（ヘッダー・追加ボタン・ナビ）はデータを待たずに描き、一覧だけをここで背景取得する。
 * サーバーコンポーネントで Notion を await すると、その間は追加ボタンも出ない。
 * API 経由にすると Service Worker の networkFirst（保存済みへ3秒で倒す・issue #718）が効き、
 * 通信が弱くても前回の内容が出る。
 *
 * 応答は要求ごとの通し番号で採否を決める。保存直後の `reload()` が、まだ飛んでいる古い取得より
 * 先に届いても、後から届いた古い応答で上書きされない。
 */
export function useApiResource<T>(url: string, failureMessage: string): ApiResource<T> {
  const [data, setData] = useState<T | null>(null);
  // 最後に取得を終えた要求の通し番号。いまの nonce と違えば、まだ要求が終わっていない。
  const [settledNonce, setSettledNonce] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [nonce, setNonce] = useState(0);

  const offline = useOffline();
  const offlineRef = useRef(offline);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  const latestRequestIdRef = useRef(0);

  const fetchNow = useCallback(async (requestNonce: number) => {
    const requestId = ++latestRequestIdRef.current;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new ServerMessageError(body?.message ?? body?.error ?? failureMessage);
      }

      const responseStale = response.headers.get("X-Dayspan-Stale") === "1";
      const body = (await response.json()) as T;
      if (latestRequestIdRef.current !== requestId) return;

      setData(body);
      setError(null);
      setStale(responseStale);
    } catch (cause) {
      if (latestRequestIdRef.current !== requestId) return;

      // 取れなくても前回の内容は残す。空へ戻すと、通信が切れた瞬間に一覧が消える。
      setError(
        isOfflineNow(offlineRef.current)
          ? null
          : cause instanceof ServerMessageError
            ? cause.message
            : failureMessage,
      );
    } finally {
      if (latestRequestIdRef.current === requestId) setSettledNonce(requestNonce);
    }
  }, [url, failureMessage]);

  useEffect(() => {
    // effect の同期部分で state を動かさないよう、次のタスクで取りにいく。
    const timer = setTimeout(() => void fetchNow(nonce), 0);
    return () => clearTimeout(timer);
  }, [fetchNow, nonce]);

  const loading = settledNonce !== nonce;

  // オフライン中は保存済みが表示されている。戻ってきた時点で最新へ取り直す。
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (offline) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    setNonce((n) => n + 1);
  }, [offline]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const mutate = useCallback((update: (current: T) => T) => {
    setData((current) => (current === null ? current : update(current)));
  }, []);

  return { data, loading, error, stale, reload, mutate };
}
