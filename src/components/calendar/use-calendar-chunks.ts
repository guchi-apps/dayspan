"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "next/offline";

import { isOfflineNow } from "@/components/offline/offline-state";
import { shiftMonthKey } from "@/lib/calendar-range";

import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
  TravelItem,
  WritableCalendar,
} from "@/types/calendar";
import type { WorkRecordItem } from "@/types/work";

import { taskOccurrences } from "./item-layout";

/**
 * 1ヶ月ぶんの保持データ。
 *
 * 継ぎ足すだけにすると、外部で削除された予定がいつまでも残る。月ごとに丸ごと差し替える
 * 単位にしておくことで、取り直した月からは消えたものが確実に消える。
 */
type MonthChunk = {
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  travels: TravelItem[];
  workRecords: WorkRecordItem[];
  /** 取得時刻。一定時間経った月は、窓に入り直したときに取り直す。 */
  fetchedAt: number;
};

/** 取得の失敗が続いても要求を出し続けないよう、再試行の間隔には下限を設ける。 */
const MIN_REFRESH_SECONDS = 30;

const NO_MONTHS: ReadonlySet<string> = new Set<string>();

/** 日時文字列（YYYY-MM-DD または ISO 8601）の先頭は必ず YYYY-MM。 */
function monthKeysBetween(start: string, end: string): string[] {
  const first = start.slice(0, 7);
  const last = end.slice(0, 7);
  if (last <= first) return [first];

  const months = [first];
  let cursor = first;

  // 日をまたぐ予定は月もまたぐ。壊れた日付で伸び続けないよう上限を置く。
  while (cursor < last && months.length < 24) {
    cursor = shiftMonthKey(cursor, 1);
    months.push(cursor);
  }

  return months;
}

/** 保存や削除で内容が変わった期間。取り直す月を絞り込むために使う。 */
export type TouchedRange = { start: string; end: string };

/**
 * 保存済みの応答を、いまの形へ揃える（docs/spec.md §21）。
 *
 * Service Workerは `/api/calendar` `/api/tasks` の応答を保存しており、紐づけが1件（`link`）
 * だった頃の応答が新しいJSへ渡ることがある。世代（`public/sw.js` の `VERSION`）を上げても、
 * 古い世代が制御している間は前の応答が返るため、読む側でも受けられるようにしておく。
 * `links` を持たないまま読むと、紐づけを読む場所（印・一覧・表示画面）で落ちる。
 */
export function withTaskLinks(tasks: TaskItem[]): TaskItem[] {
  return tasks.map((task) => (task.links ? task : { ...task, links: [] }));
}

/**
 * 勤務場所を持たない応答も受ける（docs/spec.md §21）。
 *
 * `workRecords` は項目が増えただけの変更なので `public/sw.js` の `VERSION` は上げていない
 * （上げると `activate` で古い世代のキャッシュがまとめて消え、オフラインで開けていた画面が
 * 一度失われる）。そのぶん、勤務場所を足す前に保存された応答がそのまま渡ってくる。
 */
function withWorkRecords(data: CalendarLoadResult): CalendarLoadResult {
  return data.workRecords ? data : { ...data, workRecords: [] };
}

/**
 * タスクがカレンダーで場所を取っている日付。期限と予定日で別の日に現れるため、
 * 取り直しの対象も両方になる（どちらも未設定ならカレンダーに出ていない）。
 */
export function taskRanges(task: Pick<TaskItem, "due" | "planned">): TouchedRange[] {
  return [task.due, task.planned]
    .filter((date): date is string => Boolean(date))
    .map((date) => ({ start: date, end: date }));
}

/** 変わった期間がかかる月すべて。 */
export function monthsOfRanges(ranges: TouchedRange[]): string[] {
  const months = new Set<string>();

  for (const range of ranges) {
    for (const month of monthKeysBetween(range.start, range.end)) months.add(month);
  }

  return [...months];
}

/** 取得結果を月ごとに仕分ける。月をまたぐ予定は、かかる月すべてに入る。 */
function splitByMonth(
  data: Pick<CalendarLoadResult, "events" | "tasks" | "reminders" | "travels" | "workRecords">,
  months: string[],
  fetchedAt: number,
): Map<string, MonthChunk> {
  const chunks = new Map<string, MonthChunk>();
  for (const month of months) {
    chunks.set(month, {
      events: [],
      tasks: [],
      reminders: [],
      travels: [],
      workRecords: [],
      fetchedAt,
    });
  }

  for (const event of data.events) {
    for (const month of monthKeysBetween(event.start, event.end)) {
      chunks.get(month)?.events.push(event);
    }
  }

  for (const task of data.tasks) {
    // 期限と予定日が別の月にあるタスクは、どちらの月にも入れる。片方だけに入れると、
    // もう一方の月を見ているときにその日の枠が出てこない（表示は月ごとに保持している）。
    // 同じ月に両方あるときは1件でよい（枠に分けるのは描画側）。
    const months = new Set<string>();

    for (const occurrence of taskOccurrences(task)) {
      const month = occurrence.date.slice(0, 7);
      if (months.has(month)) continue;

      months.add(month);
      chunks.get(month)?.tasks.push(task);
    }
  }
  for (const reminder of data.reminders) {
    chunks.get(reminder.date.slice(0, 7))?.reminders.push(reminder);
  }
  for (const travel of data.travels) {
    // 日をまたぐ移動（夜行バスなど）は、かかる月すべてに入れる。予定と同じ扱い。
    for (const month of monthKeysBetween(travel.start, travel.end)) {
      chunks.get(month)?.travels.push(travel);
    }
  }

  // 出張は月をまたぐ（docs/spec.md §34）。かかる月すべてに入れないと、月を送った先の
  // 日付の見出しから勤務場所が抜ける。
  for (const record of data.workRecords ?? []) {
    for (const month of monthKeysBetween(record.startDate, record.endDate)) {
      chunks.get(month)?.workRecords.push(record);
    }
  }

  return chunks;
}

/**
 * 窓の中の月だけを残す。
 *
 * 捨てないと、スクロールし続けたぶんだけ保持量が増える。描画は窓の中しか見ないので、
 * 取得結果を書き込むときにまとめて落とす。
 */
function pruneToWindow(
  chunks: Map<string, MonthChunk>,
  windowMonths: readonly string[],
): Map<string, MonthChunk> {
  const keep = new Set(windowMonths);
  const next = new Map<string, MonthChunk>();

  for (const [month, chunk] of chunks) {
    if (keep.has(month)) next.set(month, chunk);
  }

  return next;
}

export type CalendarWindowData = {
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
  /** まだ一度も取得できていない月。予定が無いのか読み込み中なのかを描き分けるために使う。 */
  pendingMonths: ReadonlySet<string>;
  /**
   * 指定した月を取り直す。null を渡すと保持しているすべての月が対象。
   * 予定やタスクを保存したあと、変わった月だけを取り直すために呼ぶ。
   */
  invalidate: (months: string[] | null) => void;
};

/**
 * 月表示のデータを、画面に出しうる月のぶんだけ保持する。
 *
 * 移動のたびにページごと描き直すと、そのつど窓ぶん全部を外部APIから取り直すことになり、
 * 押してから返るまで待たされる。ここでは足りない月だけをAPIから足し、窓から外れた月を捨てる。
 * ページの再レンダリングを伴わないため、開いているダイアログも閉じない。
 */
export function useCalendarChunks({
  enabled,
  windowMonths,
  initial,
  serverMonths,
  autoRefreshSeconds,
  onLoadingChange,
}: {
  /** 月表示のときだけ働かせる。1日・3日・週表示は取得範囲が狭く、窓で持つ必要がない。 */
  enabled: boolean;
  /** いま画面に出しうる月。週の並びが触れる月から導く。 */
  windowMonths: string[];
  initial: CalendarLoadResult;
  /** initial が満たしている月。サーバーが描いた範囲と一致していなければならない。 */
  serverMonths: string[];
  autoRefreshSeconds: number;
  /** 取得中かどうか。読み込み中の表示はSuspense境界の外にあるため、呼び出し側へ渡す。 */
  onLoadingChange: (loading: boolean) => void;
}): CalendarWindowData {
  const [chunks, setChunks] = useState(() =>
    splitByMonth(withWorkRecords(initial), serverMonths, Date.now()),
  );
  const [meta, setMeta] = useState({
    calendars: initial.calendars,
    notionReady: initial.notionReady,
    reminderReady: initial.reminderReady,
    errors: initial.errors,
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  const inFlight = useRef(new Set<string>());

  // fetchMonths からは常に最新のものを呼びたいが、fetchMonths 自体は作り直したくない。
  const onLoadingChangeRef = useRef(onLoadingChange);
  useEffect(() => {
    onLoadingChangeRef.current = onLoadingChange;
  }, [onLoadingChange]);

  // 取得に失敗した理由がオフラインかどうか（issue #321）。同じ ref の作りで最新を参照する。
  const offline = useOffline();
  const offlineRef = useRef(offline);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  // 取得が終わった時点でどこを見ているかは、要求を出した時点とは限らない。
  // 破棄の判断は「今の窓」で行う必要があるため、最新の窓を参照できるようにしておく。
  const windowRef = useRef(windowMonths);
  useEffect(() => {
    windowRef.current = windowMonths;
  }, [windowMonths]);

  // サーバー側が描き直された（保存後の再取得など）ときは、そちらを正として入れ替える。
  const seededRef = useRef(initial);
  useEffect(() => {
    if (seededRef.current === initial) return;
    seededRef.current = initial;

    setChunks(splitByMonth(withWorkRecords(initial), serverMonths, Date.now()));
    setMeta({
      calendars: initial.calendars,
      notionReady: initial.notionReady,
      reminderReady: initial.reminderReady,
      errors: initial.errors,
    });
    setLoadError(null);
  }, [initial, serverMonths]);

  const fetchMonths = useCallback(async (months: string[]) => {
    months.forEach((month) => inFlight.current.add(month));
    onLoadingChangeRef.current(true);

    try {
      const params = new URLSearchParams({ months: months.join(",") });
      const response = await fetch(`/api/calendar?${params.toString()}`);
      if (!response.ok) throw new Error(`status ${response.status}`);

      const data = (await response.json()) as CalendarLoadResult;
      const fresh = splitByMonth(
        { ...withWorkRecords(data), tasks: withTaskLinks(data.tasks) },
        months,
        Date.now(),
      );

      setChunks((prev) => {
        const next = new Map(prev);
        for (const [month, chunk] of fresh) next.set(month, chunk);
        return pruneToWindow(next, windowRef.current);
      });
      setMeta({
        calendars: data.calendars,
        notionReady: data.notionReady,
        reminderReady: data.reminderReady,
        errors: data.errors,
      });
      setLoadError(null);
    } catch {
      const fetchedAt = Date.now();

      setChunks((prev) => {
        const next = new Map(prev);

        // 失敗した月にも取得時刻を刻む。刻まないと「未取得」のままで要求が止まらなくなる。
        // 既に持っている月は、古くても消さずに残したほうが読める。
        for (const month of months) {
          const existing = next.get(month);
          next.set(month, {
            events: existing?.events ?? [],
            tasks: existing?.tasks ?? [],
            reminders: existing?.reminders ?? [],
            travels: existing?.travels ?? [],
            workRecords: existing?.workRecords ?? [],
            fetchedAt,
          });
        }

        return pruneToWindow(next, windowRef.current);
      });

      // オフラインなら失敗として出さない（issue #321）。取りにいけないのは分かっている状態で、
      // 画面の上には既に OfflineNotice の帯が出ている。ここに赤い「取得できませんでした」を
      // 重ねると、通信が戻れば解消する状態を失敗として伝えることになる（docs/spec.md §21）。
      setLoadError(
        isOfflineNow(offlineRef.current)
          ? null
          : "表示範囲の予定とタスクを取得できませんでした。",
      );
    } finally {
      months.forEach((month) => inFlight.current.delete(month));
      onLoadingChangeRef.current(inFlight.current.size > 0);
    }
  }, []);

  // 足りない月・古くなった月を取りにいく。取得できると chunks が変わって再実行され、
  // 「足りない月なし」で止まる。
  useEffect(() => {
    if (!enabled) return;

    const ttl = Math.max(autoRefreshSeconds, MIN_REFRESH_SECONDS) * 1000;
    const now = Date.now();

    const needed = windowMonths.filter((month) => {
      if (inFlight.current.has(month)) return false;

      const chunk = chunks.get(month);
      return !chunk || now - chunk.fetchedAt > ttl;
    });

    if (needed.length === 0) return;
    void fetchMonths(needed);
  }, [enabled, windowMonths, chunks, autoRefreshSeconds, fetchMonths]);

  // 窓のぶんを1つに束ねる。月をまたぐ予定は複数の月に入っているため、ここで重複を落とす。
  const { events, tasks, reminders, travels, workRecords } = useMemo(() => {
    const events: CalendarEventItem[] = [];
    const tasks: TaskItem[] = [];
    const reminders: ReminderItem[] = [];
    const travels: TravelItem[] = [];
    const workRecords: WorkRecordItem[] = [];
    const seenEvents = new Set<string>();
    const seenTasks = new Set<string>();
    const seenReminders = new Set<string>();
    const seenTravels = new Set<string>();
    const seenWorkRecords = new Set<string>();

    for (const month of windowMonths) {
      const chunk = chunks.get(month);
      if (!chunk) continue;

      for (const event of chunk.events) {
        // 別のカレンダーに同じIDの予定がありうるため、カレンダーと組にして1件とみなす。
        const key = `${event.calendarId} ${event.id}`;
        if (seenEvents.has(key)) continue;

        seenEvents.add(key);
        events.push(event);
      }

      for (const task of chunk.tasks) {
        if (seenTasks.has(task.id)) continue;

        seenTasks.add(task.id);
        tasks.push(task);
      }
      for (const reminder of chunk.reminders) {
        if (seenReminders.has(reminder.id)) continue;
        seenReminders.add(reminder.id);
        reminders.push(reminder);
      }
      for (const travel of chunk.travels) {
        if (seenTravels.has(travel.id)) continue;
        seenTravels.add(travel.id);
        travels.push(travel);
      }
      for (const record of chunk.workRecords) {
        if (seenWorkRecords.has(record.id)) continue;
        seenWorkRecords.add(record.id);
        workRecords.push(record);
      }
    }

    return { events, tasks, reminders, travels, workRecords };
  }, [chunks, windowMonths]);

  // 一度も取得できていない月だけを「読み込み中」とする。取り直し中の月まで含めると、
  // 保存のたびにその月がいったん骨組みへ戻り、内容が消えたように見えてしまう。
  const pendingMonths = useMemo(
    () => new Set(windowMonths.filter((month) => !chunks.has(month))),
    [chunks, windowMonths],
  );

  const invalidate = useCallback((months: string[] | null) => {
    if (months && months.length === 0) return;
    const target = months ? new Set(months) : null;

    setChunks((prev) => {
      const next = new Map(prev);
      let changed = false;

      for (const [month, chunk] of prev) {
        if (target && !target.has(month)) continue;

        // 取得時刻を無効にすると、下の効果が「古い月」として拾って取り直す。
        next.set(month, { ...chunk, fetchedAt: 0 });
        changed = true;
      }

      // 保持していない月だけを指された場合は何も変わらない。参照も変えない。
      return changed ? next : prev;
    });
  }, []);

  // 月表示以外は、サーバーが描いたぶんをそのまま使う。
  if (!enabled) {
    return {
      events: initial.events,
      tasks: initial.tasks,
      reminders: initial.reminders,
      travels: initial.travels,
      workRecords: initial.workRecords ?? [],
      calendars: initial.calendars,
      notionReady: initial.notionReady,
      reminderReady: initial.reminderReady,
      errors: initial.errors,
      loadError: null,
      pendingMonths: NO_MONTHS,
      invalidate,
    };
  }

  return {
    events,
    tasks,
    reminders,
    travels,
    workRecords,
    calendars: meta.calendars,
    notionReady: meta.notionReady,
    reminderReady: meta.reminderReady,
    errors: meta.errors,
    loadError,
    pendingMonths,
    invalidate,
  };
}
