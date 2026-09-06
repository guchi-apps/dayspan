import { cn } from "@/lib/utils";

/**
 * カレンダー上で「起こらなかった予定」を示す印（docs/spec.md §37）。
 *
 * 中止と不参加で形を分けない。月表示のチップに残るのは9〜10pxで、そこで2種類の線画を
 * 読み分けることはできず、その幅は予定名が使うべきもの。どちらなのかは表示画面と
 * 読み上げ（sr-only）に残す。
 *
 * 図柄は lucide の `ban`（斜線入りの丸）。活動記録の印（塗らない円）と紛れないよう、
 * 斜線を必ず引く。線は太めにして、10px 以下でも輪郭が潰れないようにする。
 */
export function EventOutcomeMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      className={cn("shrink-0", className)}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  );
}
