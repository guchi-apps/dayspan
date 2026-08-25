"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { ChevronLeft, ChevronRight, CircleAlert, Plus } from "lucide-react";

import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { SettingsShell } from "@/components/settings/settings-shell";
import { tagChipClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkRecordDialog, type WorkDraft } from "@/components/work/work-record-dialog";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import {
  coversDate,
  WORK_TODO_LABELS,
  workTodos,
  type WorkCapabilities,
  type WorkRecordItem,
  type WorkTodo,
} from "@/types/work";

/**
 * 勤務場所と出張の画面（docs/spec.md §34）。
 *
 * 登録も確認もこの画面に閉じている。勤務場所は毎日押すものだが、記録（活動記録）のように
 * 「いま」その瞬間を押さえる操作ではなく、一日の終わりや翌朝にまとめて入れられる。
 * 記録画面へ混ぜず専用の画面に置いているのはそのため。
 */
export function WorkScreen({
  monthKey,
  todayKey,
  records,
  openTrips,
  placeOptions,
  capabilities,
}: {
  /** YYYY-MM */
  monthKey: string;
  todayKey: string;
  /** 表示中の月にかかる記録。 */
  records: WorkRecordItem[];
  /** 手続きが残っている出張。月の外のものも含む。 */
  openTrips: WorkRecordItem[];
  placeOptions: TagOption[];
  capabilities: WorkCapabilities;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // 記録の追加・変更はすべて書き込み。オフライン中は押せないようにする（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでもこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  useWarmOfflinePage("/work");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkDraft | null>(null);

  const days = useMemo(() => daysOfMonth(monthKey), [monthKey]);
  const todayRecord = records.find((record) => coversDate(record, todayKey)) ?? null;
  const showsToday = todayKey.slice(0, 7) === monthKey;

  const send = async (path: string, init: RequestInit, fallback: string): Promise<boolean> => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * 今日の勤務場所を1押しで決める。
   *
   * すでに同じ場所が入っているときは取り消す。押した先が変わらない操作を残すより、
   * 押し間違えたときに同じ場所をもう一度押せば戻せるほうが道が短い。
   */
  const pickToday = async (place: string) => {
    if (todayRecord?.businessTrip) return;

    if (todayRecord && todayRecord.place === place) {
      await send(
        `/api/work/records/${todayRecord.id}`,
        { method: "DELETE" },
        "勤務場所を取り消せませんでした。",
      );
      return;
    }

    if (todayRecord) {
      await send(
        `/api/work/records/${todayRecord.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place, title: place }),
        },
        "勤務場所を変更できませんでした。",
      );
      return;
    }

    await send(
      "/api/work/records",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: todayKey, place, title: place }),
      },
      "勤務場所を登録できませんでした。",
    );
  };

  /** 出張の手続きの済み・未済を切り替える。日付は動かさないため、重なりの確認は要らない。 */
  const toggleTodo = async (trip: WorkRecordItem, todo: WorkTodo, done: boolean) => {
    await send(
      `/api/work/records/${trip.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [todo]: done }),
      },
      "出張の状況を変更できませんでした。",
    );
  };

  const openDay = (dateKey: string) => {
    const existing = records.find((record) => coversDate(record, dateKey));
    setDraft(
      existing
        ? { mode: "edit", record: existing }
        : { mode: "create", startDate: dateKey, businessTrip: false },
    );
  };

  const monthLabel = `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
  const openTodos = openTrips.flatMap((trip) => workTodos(trip, todayKey));

  return (
    <SettingsShell title="勤務" backHref="/activity" backLabel="記録">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/work?month=${shiftMonth(monthKey, -1)}`} aria-label="前の月">
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <span className="type-title-medium tabular-nums">{monthLabel}</span>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/work?month=${shiftMonth(monthKey, 1)}`} aria-label="次の月">
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>

      {error && (
        <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
          {error}
        </p>
      )}

      {/* 出張。未対応の手続きが残っているものを先頭に置く。 */}
      {capabilities.businessTrip && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="type-title-small">出張</h2>
            {openTodos.length > 0 && (
              <span className="type-label-medium flex items-center gap-1 text-error">
                <CircleAlert className="size-3.5" />
                未対応 {openTodos.length}件
              </span>
            )}
          </div>

          {openTrips.length === 0 && monthTrips(records).length === 0 ? (
            <p className="type-body-small text-on-surface-variant">
              この月の出張はありません。日を押すと出張として登録できます。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {sortTrips(openTrips, monthTrips(records), todayKey).map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  todayKey={todayKey}
                  approval={capabilities.approval}
                  disabled={busy || pending || offline}
                  onToggle={toggleTodo}
                  onOpen={() => setDraft({ mode: "edit", record: trip })}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* この月の勤務場所。今日のぶんだけは選択肢を並べ、1押しで決められるようにする。 */}
      <section className="flex flex-col gap-3">
        <h2 className="type-title-small">この月の勤務場所</h2>

        {showsToday && (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="type-label-large">今日の勤務場所</span>
                <span className="type-body-small ml-auto tabular-nums text-on-surface-variant">
                  {dayLabel(todayKey)}
                </span>
              </div>

              {todayRecord?.businessTrip ? (
                <p className="type-body-medium">
                  出張・{todayRecord.title}
                  <span className="type-body-small ml-2 text-on-surface-variant">
                    直すときは上の出張から
                  </span>
                </p>
              ) : placeOptions.length === 0 ? (
                <p className="type-body-small text-on-surface-variant">
                  勤務場所の選択肢がありません。
                  <Link href="/settings/tags" className="ml-1 underline">
                    設定 ▸ タグ
                  </Link>
                  から追加してください。
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {placeOptions.map((option) => {
                    const selected = todayRecord?.place === option.name;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={busy || pending || offline}
                        aria-pressed={selected}
                        onClick={() => pickToday(option.name)}
                        className={cn(
                          "type-label-large rounded-full border px-4 py-2 transition-colors disabled:opacity-38",
                          selected
                            ? cn("border-transparent font-bold", tagChipClass(option.color))
                            : "border-outline text-on-surface hover:bg-on-surface/8",
                        )}
                      >
                        {option.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Tally records={records} days={days} />

        <Card className="py-2">
          <CardContent className="px-4">
            {days.map((dateKey) => {
              const record = records.find((item) => coversDate(item, dateKey));
              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => openDay(dateKey)}
                  className="flex w-full items-center gap-3 border-b border-outline-variant py-2.5 text-left last:border-b-0 hover:bg-on-surface/8"
                >
                  <span
                    className={cn(
                      "type-body-small w-16 shrink-0 tabular-nums",
                      weekdayClass(dateKey),
                      dateKey === todayKey && "font-bold",
                    )}
                  >
                    {dayLabel(dateKey)}
                  </span>
                  {record ? (
                    <span
                      className={cn(
                        "type-body-medium min-w-0 truncate",
                        record.businessTrip && "font-bold text-travel",
                      )}
                    >
                      {record.businessTrip ? `出張・${record.title}` : (record.place ?? record.title)}
                    </span>
                  ) : (
                    <span className="type-body-medium text-outline">未登録</span>
                  )}
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Button
          variant="outline"
          disabled={offline}
          onClick={() =>
            setDraft({ mode: "create", startDate: defaultDate(monthKey, todayKey), businessTrip: true })
          }
        >
          <Plus className="size-4" />
          出張を追加
        </Button>
      </section>

      {draft && (
        <WorkRecordDialog
          draft={draft}
          placeOptions={placeOptions}
          capabilities={capabilities}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </SettingsShell>
  );
}

/** 出張1件ぶんの行。済み・未済はその場で切り替えられる。 */
function TripRow({
  trip,
  todayKey,
  approval,
  disabled,
  onToggle,
  onOpen,
}: {
  trip: WorkRecordItem;
  todayKey: string;
  approval: boolean;
  disabled: boolean;
  onToggle: (trip: WorkRecordItem, todo: WorkTodo, done: boolean) => void;
  onOpen: () => void;
}) {
  const todos = workTodos(trip, todayKey);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3",
        todos.length > 0 ? "border-error" : "border-outline-variant",
      )}
    >
      <button type="button" onClick={onOpen} className="flex items-baseline gap-2 text-left">
        <span className="type-body-large min-w-0 truncate font-bold">{trip.title}</span>
        <span className="type-body-small ml-auto shrink-0 tabular-nums text-on-surface-variant">
          {spanLabel(trip)}
        </span>
      </button>

      {approval && (
        <div className="flex flex-wrap gap-2">
          {(["preApplied", "postRegistered"] as const).map((todo) => {
            const done = todo === "preApplied" ? trip.preApplied : trip.postRegistered;
            // 事後登録は出張が終わってから。終わる前は押せる状態にしておく必要も無い。
            const waiting = todo === "postRegistered" && !done && trip.endDate >= todayKey;

            return (
              <button
                key={todo}
                type="button"
                disabled={disabled}
                aria-pressed={done}
                onClick={() => onToggle(trip, todo, !done)}
                className={cn(
                  "type-label-medium rounded-full border px-3 py-1.5 transition-colors disabled:opacity-38",
                  done
                    ? "border-transparent bg-travel-container text-on-travel-container"
                    : waiting
                      ? "border-dashed border-outline text-on-surface-variant"
                      : "border-transparent bg-error-container font-bold text-on-error-container",
                )}
              >
                {WORK_TODO_LABELS[todo]} {done ? "済" : waiting ? "出張後" : "未"}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** その月に何日ずつどこで働いたか。勤務場所ごとに数える。 */
function Tally({ records, days }: { records: WorkRecordItem[]; days: string[] }) {
  const counts = new Map<string, number>();
  for (const dateKey of days) {
    const record = records.find((item) => coversDate(item, dateKey));
    if (!record) continue;
    const key = record.businessTrip ? "出張" : (record.place ?? "その他");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
      {[...counts.entries()].map(([name, count]) => (
        <span key={name} className="type-body-small text-on-surface-variant">
          <b className="type-title-small mr-1 tabular-nums text-on-surface">{count}</b>
          {name}
        </span>
      ))}
    </div>
  );
}

// --- 表示のための小さな関数 ---

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** YYYY-MM-DD の曜日。UTCで組み立てて、実行環境のローカル時刻に依存させない。 */
function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

function dayLabel(dateKey: string): string {
  return `${Number(dateKey.slice(8, 10))}(${WEEKDAYS[weekdayOf(dateKey)]})`;
}

function weekdayClass(dateKey: string): string {
  const day = weekdayOf(dateKey);
  if (day === 0) return "text-error";
  if (day === 6) return "text-travel";
  return "text-on-surface-variant";
}

function spanLabel(trip: WorkRecordItem): string {
  const short = (dateKey: string) => `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
  return trip.startDate === trip.endDate
    ? short(trip.startDate)
    : `${short(trip.startDate)} – ${short(trip.endDate)}`;
}

function daysOfMonth(monthKey: string): string[] {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: lastDay },
    (_, index) => `${monthKey}-${String(index + 1).padStart(2, "0")}`,
  );
}

function shiftMonth(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 追加を押したときの初期の日付。表示中の月に今日があればその日、無ければ月の初日。 */
function defaultDate(monthKey: string, todayKey: string): string {
  return todayKey.slice(0, 7) === monthKey ? todayKey : `${monthKey}-01`;
}

function monthTrips(records: WorkRecordItem[]): WorkRecordItem[] {
  return records.filter((record) => record.businessTrip);
}

/**
 * 出張の並び。手続きが残っているものを先に、そのあとを日付順に置く。
 * 開いた理由のほとんどが「まだ済ませていないものを片付けること」のため。
 */
function sortTrips(
  openTrips: WorkRecordItem[],
  inMonth: WorkRecordItem[],
  todayKey: string,
): WorkRecordItem[] {
  const byId = new Map<string, WorkRecordItem>();
  for (const trip of [...openTrips, ...inMonth]) byId.set(trip.id, trip);

  return [...byId.values()].sort((a, b) => {
    const openA = workTodos(a, todayKey).length > 0 ? 0 : 1;
    const openB = workTodos(b, todayKey).length > 0 ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return a.startDate.localeCompare(b.startDate);
  });
}
