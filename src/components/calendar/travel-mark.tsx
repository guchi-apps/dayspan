import { cn } from "@/lib/utils";

/**
 * カレンダー上で移動を示す印（docs/spec.md §29）。
 *
 * 日付リマインドの菱形・タスクの縦棒と同じく、形だけで見分けられる最小限の印にする。
 * 電車や車のアイコンは輪郭を読ませるために大きさが要り、9〜10pxの枠では行き先の幅を
 * その分奪う。移動は「どこからどこへ」なので、向きを持つ矢印にしている。
 */
export function TravelMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
    >
      <path d="M5 12h13" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
