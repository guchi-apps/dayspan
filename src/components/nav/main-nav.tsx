"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, CalendarDays, ListChecks, Settings } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/calendar", key: "calendar", label: "カレンダー", icon: CalendarDays },
  { href: "/tasks", key: "tasks", label: "タスク", icon: ListChecks },
  { href: "/reminders", key: "reminders", label: "日付", icon: BellRing },
  { href: "/settings", key: "settings", label: "設定", icon: Settings },
] as const;

export type NavKey = (typeof ITEMS)[number]["key"];

/**
 * M3のナビゲーションバー（docs/spec.md §4）。
 * 選択中の項目はアイコンの背後に「アクティブインジケーター」の丸みを表示し、
 * 色だけに頼らずに現在地が分かるようにする。
 */
export function BottomNav({ current }: { current: NavKey }) {
  const router = useRouter();

  const handleCalendarClick = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayKey = `${year}-${month}-${day}`;
    router.push(`/calendar?view=day1&date=${todayKey}`);
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
              className="flex w-full max-w-[112px] flex-col items-center gap-1"
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
                  "type-label-medium",
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
            className="flex w-full max-w-[112px] flex-col items-center gap-1"
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
                "type-label-medium",
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
export function HeaderNav({ current }: { current: NavKey }) {
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
            <Icon className="size-[18px]" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
