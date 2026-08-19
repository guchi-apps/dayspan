"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, CalendarDays, ListChecks, Settings, Timer } from "lucide-react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { cn } from "@/lib/utils";

// 活動記録を先頭に置く（docs/spec.md §27）。押した時点から記録が始まる画面で、
// 開くのは「いま何かを始める・終える」その瞬間に限られる。探してから押すのでは間に合わない。
const ITEMS = [
  { href: "/activity", key: "activity", label: "記録", icon: Timer },
  { href: "/calendar", key: "calendar", label: "カレンダー", icon: CalendarDays },
  { href: "/tasks", key: "tasks", label: "タスク", icon: ListChecks },
  { href: "/reminders", key: "reminders", label: "日付", icon: BellRing },
  { href: "/settings", key: "settings", label: "設定", icon: Settings },
] as const;

export type NavKey = (typeof ITEMS)[number]["key"];

/**
 * 記録中であることを示す印。
 *
 * 記録中かどうかは、記録の画面を開かなくても分かる必要がある。止め忘れたまま
 * 別の画面で作業していると、その間ずっと同じ項目を記録し続けてしまうため。
 */
function RunningDot() {
  return (
    <span
      aria-hidden
      className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-primary"
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

    const today = new Date();
    const todayKey = timeZone
      ? createCalendarDateUtils(timeZone).todayKey()
      : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
          today.getDate(),
        ).padStart(2, "0")}`;

    router.push(`/calendar?date=${todayKey}`);
  };

  return (
    // viewport-fit=cover でページがブラウザのツールバーやホームインジケーターの下まで
    // 広がるため、その分を内側へ確保しないとタップがブラウザ側に取られる。
    <nav
      className="flex shrink-0 items-start justify-around bg-surface-container px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {ITEMS.map((item) => {
        const active = item.key === current;
        const Icon = item.icon;

        if (item.key === "calendar") {
          return (
            <button
              key={item.href}
              onClick={handleCalendarClick}
              aria-current={active ? "page" : undefined}
              className="flex w-full max-w-[112px] min-w-0 flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "flex h-8 w-16 items-center justify-center rounded-full transition-colors",
                  active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
                )}
              >
                <Icon className="size-6" />
              </span>
              <span
                className={cn(
                  // 項目が5つ並ぶため、狭い画面では「カレンダー」の幅が1項目分を超える。
                  // min-w-0 と truncate が無いと、縮まずにナビごと横へはみ出す。
                  "type-label-medium w-full truncate text-center tracking-tight",
                  active ? "text-on-surface" : "text-on-surface-variant",
                )}
              >
                {item.label}
              </span>
            </button>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex w-full max-w-[112px] min-w-0 flex-col items-center gap-1"
          >
            <span
              className={cn(
                "flex h-8 w-16 items-center justify-center rounded-full transition-colors",
                active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
              )}
            >
              {/* 印はアイコンの角に添える。丸みの端に置くと、アイコンから離れて別の飾りに見える。 */}
              <span className="relative flex items-center">
                <Icon className="size-6" />
                {item.key === "activity" && activityRunning && <RunningDot />}
              </span>
            </span>
            <span
              className={cn(
                "type-label-medium w-full truncate text-center tracking-tight",
                active ? "text-on-surface" : "text-on-surface-variant",
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
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
  return (
    <div className="hidden items-center gap-1 md:flex">
      {ITEMS.filter((item) => item.key !== "settings").map((item) => {
        const active = item.key === current;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
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
