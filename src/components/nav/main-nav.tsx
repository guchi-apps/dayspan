import Link from "next/link";
import { CalendarDays, ListChecks, Settings } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/calendar", label: "カレンダー", icon: CalendarDays },
  { href: "/tasks", label: "タスク", icon: ListChecks },
];

/** スマートフォン向けの下部ナビゲーション（docs/spec.md §4）。PCでは各画面のヘッダーに置く。 */
export function BottomNav({ current }: { current: "calendar" | "tasks" }) {
  return (
    <nav className="flex shrink-0 border-t bg-background md:hidden">
      {ITEMS.map((item) => {
        const active = item.href === `/${current}`;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
      <Link
        href="/settings"
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground"
      >
        <Settings className="size-5" />
        設定
      </Link>
    </nav>
  );
}

/** PC向けの画面切り替え。ヘッダー内に横並びで置く。 */
export function HeaderNav({ current }: { current: "calendar" | "tasks" }) {
  return (
    <div className="hidden items-center gap-1 md:flex">
      {ITEMS.map((item) => {
        const active = item.href === `/${current}`;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-sm",
              active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
