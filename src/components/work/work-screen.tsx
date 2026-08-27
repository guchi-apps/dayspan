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
import { japaneseHolidayName } from "@/lib/japanese-holidays";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import {
  annualLeaveDays,
  coversDate,
  formatDays,
  isTripPlace,
  openWorkRecords,
  shownWorkTodos,
  WORK_TODO_LABELS,
  workTodos,
  type WorkCapabilities,
  type WorkRecordItem,
  type WorkTodo,
} from "@/types/work";

/**
 * 勤務場所・出張・年休の画面（docs/spec.md §34）。
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
  openLeaves,
  placeOptions,
  loadError = null,
  tripPlaces,
  capabilities,
}: {
  /** YYYY-MM */
  monthKey: string;
  todayKey: string;
  /** 表示中の月にかかる記録。 */
  records: WorkRecordItem[];
  /** 手続きが残っている出張。月の外のものも含む。 */
  openTrips: WorkRecordItem[];
  /** 事前申請が済んでいない年休。月の外のものも含む。 */
  openLeaves: WorkRecordItem[];
  placeOptions: TagOption[];
  /** Notionから読めなかったときの理由。画面は開いたまま、何が起きたかだけを伝える。 */
  loadError?: string | null;
  /** 出張扱いにする勤務場所の名前（docs/spec.md §34）。 */
  tripPlaces: string[];
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
   * 今日の記録をチップから直せるか。
   *
   * 場所から出張になった単日の記録（行き先＝場所名）は、もう一度押して取り消せる必要がある。
   * 1押しで登録したものを1押しで戻せないと、消すためだけに日の行から入り直すことになる。
   * 手で作った出張は行き先が場所名と違う・複数日にまたがるため、チップで上書きすると
   * 行き先や期間が消える。年休は場所と無関係に決められたものなので、日別の一覧の行から直す。
   */
  const todayEditableByChip =
    !todayRecord?.annualLeave &&
    (!todayRecord?.businessTrip ||
      (todayRecord.startDate === todayRecord.endDate &&
        todayRecord.title === todayRecord.place &&
        isTripPlace(tripPlaces, todayRecord.place)));

  /**
   * 今日の勤務場所を1押しで決める。
   *
   * すでに同じ場所が入っているときは取り消す。押した先が変わらない操作を残すより、
   * 押し間違えたときに同じ場所をもう一度押せば戻せるほうが道が短い。
   *
   * 出張扱いの場所（docs/spec.md §34）はその場で出張として登録する。出張かどうかは毎回
   * 明示して送る。送らないとNotion側の既存のチェックが残り、出張扱いでない場所へ変えても
   * 出張のままになる。
   */
  const pickToday = async (place: string) => {
    if (!todayEditableByChip) return;

    const trip = capabilities.businessTrip
      ? { businessTrip: isTripPlace(tripPlaces, place) }
      : {};

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
          body: JSON.stringify({ place, title: place, ...trip }),
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
        body: JSON.stringify({ startDate: todayKey, place, title: place, ...trip }),
      },
      "勤務場所を登録できませんでした。",
    );
  };

  /** 手続きの済み・未済を切り替える。日付は動かさないため、重なりの確認は要らない。 */
  const toggleTodo = async (record: WorkRecordItem, todo: WorkTodo, done: boolean) => {
    await send(
      `/api/work/records/${record.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [todo]: done }),
      },
      "手続きの状況を変更できませんでした。",
    );
  };

  const openDay = (dateKey: string) => {
    const existing = records.find((record) => coversDate(record, dateKey));
    setDraft(
      existing
        ? { mode: "edit", record: existing }
        : { mode: "create", startDate: dateKey, kind: "work" },
    );
  };

  const monthLabel = `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
  // 上部の2つの区画に出すのは、手続きが残っている記録だけ（docs/spec.md §34）。済んだものを
  // 月のあいだ残すと、いま手を打つべきものがその中に埋もれる。出張の前の事後登録も同じ理由で
  // 落ちる（`workTodos()` が終了日を過ぎるまで数えないため、判定を二重に持たなくてよい）。
  // 済んだ記録を直したくなったときは、下の日別の一覧から入力ダイアログを開く（issue #412）。
  const openTodos = openTrips.flatMap((trip) => workTodos(trip, todayKey));
  const trips = openWorkRecords(openTrips, todayKey);
  const leaves = openWorkRecords(openLeaves, todayKey);
  const openLeaveCount = leaves.length;

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

      {/* 書き込みの失敗を先に出す。押した操作の結果のほうが、開いた時点の取得の失敗より新しい。 */}
      {(error ?? loadError) && (
        <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
          {error ?? loadError}
        </p>
      )}

      {/* 出張。残っている手続きだけを出す。事前申請・事後登録のプロパティが無いDBでは片付ける
          手続きそのものが持てないため、区画ごと出さない。 */}
      {capabilities.approval && (
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

          {trips.length === 0 ? (
            <p className="type-body-small text-on-surface-variant">
              未対応の手続きはありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {trips.map((trip) => (
                <RecordRow
                  key={trip.id}
                  record={trip}
                  todayKey={todayKey}
                  todos={["preApplied", "postRegistered"]}
                  tone="travel"
                  disabled={busy || pending || offline}
                  onToggle={toggleTodo}
                  onOpen={() => setDraft({ mode: "edit", record: trip })}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 年休。出張と同じ形にする。開く理由の多くは「まだ申請していないものを片付けること」で、
          日別の一覧を上から探すのでは見つからないため。 */}
      {capabilities.annualLeave && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="type-title-small">年休</h2>
            {openLeaveCount > 0 && (
              <span className="type-label-medium flex items-center gap-1 text-error">
                <CircleAlert className="size-3.5" />
                未申請 {openLeaveCount}件
              </span>
            )}
          </div>

          {leaves.length === 0 ? (
            <p className="type-body-small text-on-surface-variant">
              未申請の年休はありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {leaves.map((leave) => (
                <RecordRow
                  key={leave.id}
                  record={leave}
                  todayKey={todayKey}
                  todos={["preApplied"]}
                  tone="leave"
                  disabled={busy || pending || offline}
                  onToggle={toggleTodo}
                  onOpen={() => setDraft({ mode: "edit", record: leave })}
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
                <span className={cn("type-body-small ml-auto tabular-nums", dateClass(todayKey))}>
                  {dayLabel(todayKey)}
                  {japaneseHolidayName(todayKey) && (
                    <span className="ml-1">{japaneseHolidayName(todayKey)}</span>
                  )}
                </span>
              </div>

              {!todayEditableByChip && todayRecord ? (
                <p className="type-body-medium">
                  {recordLabel(todayRecord)}
                  <span className="type-body-small ml-2 text-on-surface-variant">
                    直すときは下の日付の一覧から
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

              {/* 場所から出張になったことは、押した本人にも見えている必要がある。
                  手続きの行き先を上の出張ではなく日別の一覧にするのは、この経路で作られるのが
                  単日の出張で、事前申請を済ませた時点で上の区画から消えるため（事後登録は
                  終了日を過ぎるまで未対応に数えない）。日別の一覧はいつ押しても同じ所へ着く。 */}
              {todayEditableByChip && todayRecord?.businessTrip && (
                <p className="type-body-small text-travel">
                  この場所は出張扱いです。
                  {capabilities.approval && "事前申請・事後登録は下の日付の一覧から。"}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Tally records={records} days={days} />

        <Card className="py-2">
          <CardContent className="px-4">
            {days.map((dateKey) => {
              const record = records.find((item) => coversDate(item, dateKey));
              const holiday = japaneseHolidayName(dateKey);
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
                      dateClass(dateKey),
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
                        record.annualLeave && "font-bold text-tertiary",
                      )}
                    >
                      {recordLabel(record)}
                    </span>
                  ) : (
                    <span className="type-body-medium text-outline">未登録</span>
                  )}
                  {/* 祝日の名前。赤いだけでは何の日か分からず、色以外の手掛かりも要る。 */}
                  {holiday && (
                    <span className="type-label-small ml-auto min-w-0 truncate text-error">
                      {holiday}
                    </span>
                  )}
                  {/* 申請が残っている日は一覧からも分かるようにする。上の区画まで戻らずに気付ける。
                      祝日の名前と並ぶ日は、名前の側を削って未対応の印を残す（印は2〜3文字で、
                      削られると何が残っているのかが読めなくなる）。 */}
                  {record && workTodos(record, todayKey).length > 0 && (
                    <span
                      className={cn(
                        "type-label-small shrink-0 font-bold text-error",
                        !holiday && "ml-auto",
                      )}
                    >
                      {record.annualLeave ? "未申請" : "未対応"}
                    </span>
                  )}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* 出張・年休は先の日付に入れるものが多い。日別の一覧をスクロールして押させるより、
            開いてから日付を選ばせるほうが短い。 */}
        {(capabilities.businessTrip || capabilities.annualLeave) && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {capabilities.businessTrip && (
              <Button
                variant="outline"
                disabled={offline}
                onClick={() =>
                  setDraft({
                    mode: "create",
                    startDate: defaultDate(monthKey, todayKey),
                    kind: "trip",
                  })
                }
              >
                <Plus className="size-4" />
                出張を追加
              </Button>
            )}
            {capabilities.annualLeave && (
              <Button
                variant="outline"
                disabled={offline}
                onClick={() =>
                  setDraft({
                    mode: "create",
                    startDate: defaultDate(monthKey, todayKey),
                    kind: "leave",
                  })
                }
              >
                <Plus className="size-4" />
                年休を追加
              </Button>
            )}
          </div>
        )}
      </section>

      {draft && (
        <WorkRecordDialog
          draft={draft}
          placeOptions={placeOptions}
          tripPlaces={tripPlaces}
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

/**
 * 出張・年休1件ぶんの行。済み・未済はその場で切り替えられる。
 *
 * 出張と年休で作りを変えないのは、開く理由（まだ済ませていない手続きを片付ける）が同じで、
 * 別の形にすると同じことをするのに覚えることが2つに増えるため。違うのは色と、出せる
 * 手続きの数だけにする。
 */
function RecordRow({
  record,
  todayKey,
  todos: shown,
  tone,
  disabled,
  onToggle,
  onOpen,
}: {
  record: WorkRecordItem;
  todayKey: string;
  /** 出せる手続き。年休は事前申請だけ、出張は事前申請と事後登録。 */
  todos: WorkTodo[];
  tone: "travel" | "leave";
  disabled: boolean;
  onToggle: (record: WorkRecordItem, todo: WorkTodo, done: boolean) => void;
  onOpen: () => void;
}) {
  const chips = shownWorkTodos(record, todayKey, shown);
  // 半休の日は残り半日どこで働いたかも持つ。行に出さないと、開かないと分からない。
  const sub =
    record.annualLeave && annualLeaveDays(record.annualLeave) < 1 && record.place
      ? `残り半日は${record.place}`
      : null;

  // ここに並ぶのは手続きが残っている記録だけなので、枠は常に未対応の色にする。
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-error p-3">
      <button type="button" onClick={onOpen} className="flex flex-col gap-0.5 text-left">
        <span className="flex items-baseline gap-2">
          <span className="type-body-large min-w-0 truncate font-bold">{record.title}</span>
          <span className="type-body-small ml-auto shrink-0 tabular-nums text-on-surface-variant">
            {spanLabel(record)}
          </span>
        </span>
        {sub && <span className="type-body-small text-on-surface-variant">{sub}</span>}
      </button>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((todo) => {
            const done = todo === "preApplied" ? record.preApplied : record.postRegistered;

            return (
              <button
                key={todo}
                type="button"
                disabled={disabled}
                aria-pressed={done}
                onClick={() => onToggle(record, todo, !done)}
                className={cn(
                  "type-label-medium rounded-full border px-3 py-1.5 transition-colors disabled:opacity-38",
                  done
                    ? tone === "leave"
                      ? "border-transparent bg-tertiary-container text-on-tertiary-container"
                      : "border-transparent bg-travel-container text-on-travel-container"
                    : "border-transparent bg-error-container font-bold text-on-error-container",
                )}
              >
                {WORK_TODO_LABELS[todo]} {done ? "済" : "未"}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * その月に何日ずつどこで働いたか。勤務場所ごとに数える。
 *
 * 半休の日は年休に 0.5 日、残り半日の勤務場所に 0.5 日を足す。勤怠の提出で見るのはこの数字
 * そのもので、半休を1日として数えると使えないため。
 */
function Tally({ records, days }: { records: WorkRecordItem[]; days: string[] }) {
  const counts = new Map<string, number>();
  const add = (name: string, days: number) => counts.set(name, (counts.get(name) ?? 0) + days);

  for (const dateKey of days) {
    const record = records.find((item) => coversDate(item, dateKey));
    if (!record) continue;

    if (record.annualLeave) {
      const leave = annualLeaveDays(record.annualLeave);
      add("年休", leave);
      if (leave < 1 && record.place) add(record.place, 1 - leave);
      continue;
    }
    add(record.businessTrip ? "出張" : (record.place ?? "その他"), 1);
  }

  if (counts.size === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
      {[...counts.entries()].map(([name, count]) => (
        <span key={name} className="type-body-small text-on-surface-variant">
          <b className="type-title-small mr-1 tabular-nums text-on-surface">{formatDays(count)}</b>
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

/**
 * 日付の文字色。日曜と祝日は赤（`error`）、土曜は青（`travel`）にする。
 *
 * 祝日を日曜と同じ色にするのは、勤務場所を入れるときに見ているのが曜日ではなく
 * 「その日が働く日かどうか」のため。月曜が祝日で灰色のままだと、入れ忘れなのか
 * そもそも働いていない日なのかが一覧から読めない。
 */
function dateClass(dateKey: string): string {
  const day = weekdayOf(dateKey);
  if (day === 0 || japaneseHolidayName(dateKey)) return "text-error";
  if (day === 6) return "text-travel";
  return "text-on-surface-variant";
}

function spanLabel(record: WorkRecordItem): string {
  const short = (dateKey: string) => `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
  return record.startDate === record.endDate
    ? short(record.startDate)
    : `${short(record.startDate)} – ${short(record.endDate)}`;
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

/**
 * 一覧の1行に出す文字列。
 *
 * 年休は区分（全休・午前半休）まで出し、半休なら残り半日の勤務場所を添える。「年休」だけでは
 * 丸一日休むのか半日働くのかが読めず、月の集計の 0.5 日と行の見え方が食い違う。
 */
function recordLabel(record: WorkRecordItem): string {
  if (record.annualLeave) {
    const suffix = annualLeaveDays(record.annualLeave) < 1 && record.place ? `・${record.place}` : "";
    return `年休（${record.annualLeave}）${suffix}`;
  }
  if (record.businessTrip) return `出張・${record.title}`;
  return record.place ?? record.title;
}
