"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, CalendarDays, ListChecks, ShoppingCart, Timer } from "lucide-react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { useLongPress } from "@/components/calendar/use-long-press";
import { ActivityQuickSheet } from "@/components/nav/activity-quick-sheet";
import { isPlainClick, useOfflineNavigate } from "@/components/nav/offline-navigate";
import { cn } from "@/lib/utils";

// 並びは左から カレンダー・タスク・記録・日付・（買い物リスト）（issue #328）。
// 記録を中央に置くのは、押す回数がいちばん多く、他と同じ形で端に並べると
// 「いま始める・止める」たびに探して押すことになるため（docs/spec.md §27）。
const ITEMS = [
  { href: "/calendar", key: "calendar", label: "カレンダー", icon: CalendarDays },
  { href: "/tasks", key: "tasks", label: "タスク", icon: ListChecks },
  { href: "/activity", key: "activity", label: "記録", icon: Timer },
  { href: "/reminders", key: "reminders", label: "日付", icon: BellRing },
] as const;

export type NavKey = (typeof ITEMS)[number]["key"];

/** 下部ナビの1項目の枠。5枠目（買い物リスト）まで含めて等分するため、格子の1マスに合わせる。 */
const ITEM_CLASS = "flex w-full min-w-0 flex-col items-center gap-1";

/** アイコンを置く枠。中央の記録の円もこの高さの枠から上へはみ出させ、ラベルの高さを揃える。 */
const ICON_SLOT_CLASS = "flex h-8 w-16 items-center justify-center rounded-full transition-colors";

const LABEL_CLASS =
  // 狭い画面では「カレンダー」の幅が1項目分を超える。min-w-0 と truncate が無いと、
  // 縮まずにナビごと横へはみ出す。
  "type-label-medium w-full truncate text-center tracking-tight";

/**
 * 記録中であることを示す印。
 *
 * 記録中かどうかは、記録の画面を開かなくても分かる必要がある。止め忘れたまま
 * 別の画面で作業していると、その間ずっと同じ項目を記録し続けてしまうため。
 */
function RunningDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-primary",
        className,
      )}
    />
  );
}

/**
 * M3のナビゲーションバー（docs/spec.md §4）。
 * 選択中の項目はアイコンの背後に「アクティブインジケーター」の丸みを表示し、
 * 色だけに頼らずに現在地が分かるようにする。
 */
export function BottomNav({
  current,
  activityRunning = false,
  onCalendarClick,
  timeZone,
}: {
  current: NavKey;
  /** 活動を記録中かどうか。記録の項目へ印を出す。 */
  activityRunning?: boolean;
  /**
   * カレンダー画面から押されたときの移動。
   *
   * 画面の中で今日へ動かす（月表示のスクロールを含む）。指定が無ければURLで移動する。
   * カレンダー画面ではURLだけ書き換えても、すでに描かれている月表示はその場に留まるため。
   */
  onCalendarClick?: () => void;
  /**
   * 日付の解釈に使うタイムゾーン（`UiSetting.timeZone`）。「今日」をここから決める。
   * 端末の時計任せにすると、設定と違うタイムゾーンの端末で別の日が開く。
   */
  timeZone?: string;
}) {
  const router = useRouter();
  const navigateOffline = useOfflineNavigate();

  // 記録の長押しで出すシート（issue #328）。開くまで中身は取りにいかない。
  const [quickOpen, setQuickOpen] = useState(false);

  /**
   * カレンダーの項目は「今日へ移動」も兼ねる（issue #175）。
   *
   * 動かすのは日付だけで、表示形式は指定しない。月表示で使っていても1日表示へ落ちると、
   * 今日を見るたびに表示形式を選び直すことになるため。指定しなければ、前回の表示形式
   * （記憶が無ければ月表示）でその日が開く（issue #279）。
   */
  const handleCalendarClick = () => {
    if (onCalendarClick) {
      onCalendarClick();
      return;
    }

    // オフライン中は日付を付けずに移動する（issue #321）。Service Worker が保存しているのは
    // 直前に開いた期間で、今日を指定してもその日のぶんは取りにいけない。日付を書かなければ
    // Cookieの記憶（src/lib/calendar-view-memory.ts）が直前の表示形式・日付を埋める。
    if (navigateOffline("/calendar")) return;

    const today = new Date();
    const todayKey = timeZone
      ? createCalendarDateUtils(timeZone).todayKey()
      : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
          today.getDate(),
        ).padStart(2, "0")}`;

    router.push(`/calendar?date=${todayKey}`);
  };

  /**
   * 記録は押せば画面へ移り、長押しならその場で始める・止められる（issue #328）。
   * 長押しを受けるのは指・ペンだけ（use-long-press.ts）。
   */
  const activityHandlers = useLongPress<null>({
    onPress: () => {
      if (navigateOffline("/activity")) return;
      router.push("/activity");
    },
    onLongPress: () => setQuickOpen(true),
  });

  return (
    // viewport-fit=cover でページがブラウザのツールバーやホームインジケーターの下まで
    // 広がるため、その分を内側へ確保しないとタップがブラウザ側に取られる。
    //
    // 等分の格子にするのは、記録を必ず中央に置くため。買い物リスト（後日）の枠を
    // 空けたままにしないと、4項目では記録が中央からずれる。
    <nav className="relative grid shrink-0 grid-cols-5 items-start bg-surface-container px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      {ITEMS.map((item) => {
        const active = item.key === current;
        const Icon = item.icon;

        if (item.key === "activity") {
          return (
            <button
              key={item.href}
              {...activityHandlers(null)}
              aria-current={active ? "page" : undefined}
              aria-label="記録（長押しでその場から始める）"
              className={cn(ITEM_CLASS, "touch-none select-none")}
            >
              {/* 円は他の項目と同じ高さの枠に収め、上へだけはみ出させる。
                  円ごと持ち上げるとラベルの高さが1項目だけずれる。 */}
              <span className={cn(ICON_SLOT_CLASS, "relative")}>
                <span
                  className={cn(
                    "absolute bottom-0 flex size-14 items-center justify-center rounded-full border-4 border-surface-container elevation-1 transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary-container text-on-primary-container",
                  )}
                >
                  <Icon className="size-7" />
                  {activityRunning && (
                    // 印は円の縁に置く。記録中でも選択中でも埋もれないよう、円の色と入れ替える。
                    <RunningDot
                      className={cn(
                        "size-3 ring-2 ring-surface-container",
                        active ? "bg-primary-container" : "bg-primary",
                      )}
                    />
                  )}
                </span>
              </span>
              <span className={cn(LABEL_CLASS, active ? "text-on-surface" : "text-on-surface-variant")}>
                {item.label}
              </span>
            </button>
          );
        }

        if (item.key === "calendar") {
          return (
            <button
              key={item.href}
              onClick={handleCalendarClick}
              aria-current={active ? "page" : undefined}
              className={ITEM_CLASS}
            >
              <span
                className={cn(
                  ICON_SLOT_CLASS,
                  active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
                )}
              >
                <Icon className="size-6" />
              </span>
              <span className={cn(LABEL_CLASS, active ? "text-on-surface" : "text-on-surface-variant")}>
                {item.label}
              </span>
            </button>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(event) => {
              if (isPlainClick(event) && navigateOffline(item.href)) event.preventDefault();
            }}
            aria-current={active ? "page" : undefined}
            className={ITEM_CLASS}
          >
            <span
              className={cn(
                ICON_SLOT_CLASS,
                active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
              )}
            >
              <Icon className="size-6" />
            </span>
            <span className={cn(LABEL_CLASS, active ? "text-on-surface" : "text-on-surface-variant")}>
              {item.label}
            </span>
          </Link>
        );
      })}

      {/*
        買い物リストの枠（後日実装）。押しても何も起きないため、読み上げからは外す。
        枠を空けたままにするのは、4項目にすると記録が中央に来ないため。
      */}
      <span aria-hidden className={cn(ITEM_CLASS, "opacity-40")}>
        <span className={ICON_SLOT_CLASS}>
          <ShoppingCart className="size-6 text-on-surface-variant" />
        </span>
        <span className={cn(LABEL_CLASS, "text-on-surface-variant")}>買い物</span>
      </span>

      <ActivityQuickSheet open={quickOpen} onOpenChange={setQuickOpen} />
    </nav>
  );
}

/** PC向け。ナビゲーションバーは持たず、トップアプリバー内に切り替えを置く。 */
export function HeaderNav({
  current,
  activityRunning = false,
}: {
  current: NavKey;
  activityRunning?: boolean;
}) {
  const navigateOffline = useOfflineNavigate();

  return (
    <div className="hidden items-center gap-1 md:flex">
      {ITEMS.map((item) => {
        const active = item.key === current;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(event) => {
              if (isPlainClick(event) && navigateOffline(item.href)) event.preventDefault();
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "type-label-large flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors",
              active
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface-variant hover:bg-on-surface/8",
            )}
          >
            <span className="relative flex items-center">
              <Icon className="size-[18px]" />
              {item.key === "activity" && activityRunning && <RunningDot />}
            </span>
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
