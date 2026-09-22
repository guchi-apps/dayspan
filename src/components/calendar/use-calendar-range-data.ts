"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOffline } from "next/offline";

import { isOfflineNow } from "@/components/offline/offline-state";
import type { CalendarView } from "@/lib/calendar-range";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
  TravelItem,
  WritableCalendar,
} from "@/types/calendar";
import type { WorkRecordItem } from "@/types/work";

import {
  withEventOutcomes,
  withTaskLinks,
  withWorkRecords,
  type TouchedRange,
} from "./use-calendar-chunks";

/** 取得の失敗が続いても要求を出し続けないよう、再試行の間隔には下限を設ける。 */
const MIN_REFRESH_SECONDS = 30;

const EMPTY_RESULT: CalendarLoadResult = {
  events: [],
  tasks: [],
  reminders: [],
  travels: [],
  workRecords: [],
  calendars: [],
  notionReady: false,
  reminderReady: false,
  errors: [],
};

function normalize(data: CalendarLoadResult): CalendarLoadResult {
  return {
    ...withWorkRecords(data),
    events: withEventOutcomes(data.events),
    tasks: withTaskLinks(data.tasks),
  };
}

function rangeKey(view: CalendarView, anchorKey: string): string {
  return `${view}:${anchorKey}`;
}

export type CalendarRangeData = {
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  travels: TravelItem[];
  workRecords: WorkRecordItem[];
  calendars: WritableCalendar[];
  notionReady: boolean;
  reminderReady: boolean;
  errors: CalendarLoadResult["errors"];
  /** 連携側ではなくアプリ側の取得失敗。 */
  loadError: string | null;
  /** いま表示中の期間を、まだ一度も取得できていない。予定が無いのか読み込み中なのかを描き分ける。 */
  pending: boolean;
  /**
   * いま表示中の期間を取り直す。引数（変わった範囲）は使わない。範囲を1つしか持たず、
   * 月表示のように「かかる月だけ」を選んで取り直す必要が無いため。`useCalendarChunks` の
   * `invalidate` と同じ形にして、呼び出し側で表示形式ごとの分岐をさせない。
   */
  invalidate: (touched?: TouchedRange[] | null) => void;
};

/**
 * 日・3日・週表示のデータ。
 *
 * 月表示専用の `useCalendarChunks` は月単位で保持するが、日・3日・週表示にそのまま使うと
 * 表示中の数日ぶんのために月まるごとを取得することになり、過剰なアクセスになる
 * （docs/spec.md §20）。ここでは表示中の期間1つぶんだけを保持し、表示形式・日付が変わる
 * たびに `/api/calendar?view=&date=`（サーバーの `getSwipeFetchRange` と同じ範囲）から
 * 取り直す。取得の完了は待たず、表示形式・日付そのものの切り替えは別（`nav` の楽観値）が
 * 即座に反映する（issue #697）。
 */
export function useCalendarRangeData({
  enabled,
  view,
  anchorKey,
  dataPromise,
  seedView,
  seedAnchorKey,
  autoRefreshSeconds,
  onLoadingChange,
}: {
  /** 日・3日・週表示のときだけ働かせる。月表示ではこのフックの結果を使わない。 */
  enabled: boolean;
  view: CalendarView;
  anchorKey: string;
  /**
   * マウント時点でサーバーが描いた応答。マウント時点の表示形式が非月表示だったときだけ、
   * その期間の種として使う（以後に作られる新しい Promise は無視する。issue #697）。
   */
  dataPromise: Promise<CalendarLoadResult>;
  /** dataPromise が対応する表示形式・日付（マウント時点のもの）。 */
  seedView: CalendarView;
  seedAnchorKey: string;
  autoRefreshSeconds: number;
  onLoadingChange: (loading: boolean) => void;
}): CalendarRangeData {
  const [state, setState] = useState<{ key: string | null; data: CalendarLoadResult }>(() => ({
    key: null,
    data: EMPTY_RESULT,
  }));
  const [loadError, setLoadError] = useState<string | null>(null);

  const onLoadingChangeRef = useRef(onLoadingChange);
  useEffect(() => {
    onLoadingChangeRef.current = onLoadingChange;
  }, [onLoadingChange]);

  const offline = useOffline();
  const offlineRef = useRef(offline);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  const [seedPromise] = useState(() => dataPromise);
  const [seedKeyAtMount] = useState(() => rangeKey(seedView, seedAnchorKey));
  // マウント時点で月表示だった場合、dataPromise は月まるごとの範囲しか含んでおらず、
  // 日・3日・週表示の種としては使えない。その場合は最初から「種の判定は済んでいる」
  // 扱いにし、後段の取得（fetchRange）へそのまま任せる（issue #697）。
  const [seedSettled, setSeedSettled] = useState(() => seedView === "month");

  // 取得の管理はすべて ref で持つ。React state（再描画のもと）を読んで setState するのを
  // effect の中で行うと、更新が state から生まれているように見えて意図が伝わりにくいため、
  // 「いつ・どの期間まで取得できたか」は外部の記録（ref）として扱う。
  const inFlightKeyRef = useRef<string | null>(null);
  const fetchedRef = useRef<{ key: string | null; fetchedAt: number }>({ key: null, fetchedAt: 0 });

  useEffect(() => {
    if (seedView === "month") return;

    let cancelled = false;

    seedPromise.then(
      (data) => {
        if (cancelled) return;
        fetchedRef.current = { key: seedKeyAtMount, fetchedAt: Date.now() };
        setState({ key: seedKeyAtMount, data: normalize(data) });
        setSeedSettled(true);
      },
      () => {
        if (!cancelled) setSeedSettled(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [seedPromise, seedKeyAtMount, seedView]);

  const key = rangeKey(view, anchorKey);
  // invalidate() が押されたことを、下の取得判定の effect へ伝えるためだけの通し番号。
  // fetchedRef（ref）を古くするだけでは、effect の依存に何も変化が無く再実行されない。
  const [invalidateNonce, setInvalidateNonce] = useState(0);

  const fetchRange = useCallback(async (targetView: CalendarView, targetAnchorKey: string) => {
    const targetKey = rangeKey(targetView, targetAnchorKey);
    inFlightKeyRef.current = targetKey;
    onLoadingChangeRef.current(true);

    try {
      const params = new URLSearchParams({ view: targetView, date: targetAnchorKey });
      const response = await fetch(`/api/calendar?${params.toString()}`);
      if (!response.ok) throw new Error(`status ${response.status}`);

      const data = (await response.json()) as CalendarLoadResult;
      fetchedRef.current = { key: targetKey, fetchedAt: Date.now() };
      setState({ key: targetKey, data: normalize(data) });
      setLoadError(null);
    } catch {
      // 取得できなくても期間そのものは「試した」ことにする。刻まないと、
      // 取得できないまま同じ期間へ要求を出し続けることになる。
      fetchedRef.current = { key: targetKey, fetchedAt: Date.now() };

      // オフラインなら失敗として出さない（issue #321）。画面には既に OfflineNotice が出ている。
      setLoadError(
        isOfflineNow(offlineRef.current) ? null : "表示範囲の予定とタスクを取得できませんでした。",
      );
    } finally {
      if (inFlightKeyRef.current === targetKey) inFlightKeyRef.current = null;
      onLoadingChangeRef.current(false);
    }
  }, []);

  // 表示中の期間が変わった・古くなったら取りにいく。判定（inFlight・fetchedRef）は
  // どちらも ref のため、この effect 自体は React state を読んで setState してはいない
  // （fetchRange の中で setState するのは、あくまで fetch の応答が届いたときだけ）。
  useEffect(() => {
    if (!enabled || !seedSettled) return;
    if (inFlightKeyRef.current === key) return;

    const ttl = Math.max(autoRefreshSeconds, MIN_REFRESH_SECONDS) * 1000;
    const fetched = fetchedRef.current;
    const fresh = fetched.key === key && Date.now() - fetched.fetchedAt < ttl;
    if (fresh) return;

    void fetchRange(view, anchorKey);
  }, [enabled, seedSettled, key, view, anchorKey, autoRefreshSeconds, fetchRange, invalidateNonce]);

  /**
   * いま表示中の期間を取り直す。取得が終わるまでは、それまで持っていた内容を表示したままにする
   * （月表示の `invalidate` と同じ扱い。空へ戻すと、取り直しのたびに一瞬グリッドが空になる）。
   */
  const invalidate = useCallback((_touched?: TouchedRange[] | null) => {
    fetchedRef.current = { key: null, fetchedAt: 0 };
    setInvalidateNonce((n) => n + 1);
  }, []);

  const showing = state.key === key ? state.data : EMPTY_RESULT;

  return {
    events: showing.events,
    tasks: showing.tasks,
    reminders: showing.reminders,
    travels: showing.travels,
    workRecords: showing.workRecords,
    calendars: showing.calendars,
    notionReady: showing.notionReady,
    reminderReady: showing.reminderReady,
    errors: showing.errors,
    loadError,
    pending: state.key !== key,
    invalidate,
  };
}
