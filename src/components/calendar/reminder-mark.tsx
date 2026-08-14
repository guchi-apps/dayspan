import { cn } from "@/lib/utils";

/**
 * カレンダー上で日付リマインドを示す印。
 *
 * ベルのアイコンは輪郭を読ませるために一定の大きさが要り、項目名に使える幅をその分奪っていた。
 * 枠の高さは9〜10pxの文字に合わせてあり、削られるのはたいてい項目名のほうなので、
 * 形だけで見分けられる最小限の印に置き換えている（issue #171）。
 *
 * タスクの縦棒（期限という「点」）と取り違えないよう、菱形にして向きで分ける。
 */
export function ReminderMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("shrink-0 rotate-45 bg-tertiary", className)} />;
}
