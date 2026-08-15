import { cn } from "@/lib/utils";

/**
 * カレンダー上で活動記録（記録から作られた予定）を示す印（issue #241）。
 *
 * 塗りを落とした枠だけでは、色の薄い予定と見分けが付かない。何の枠なのかは形で示す。
 *
 * タスクの縦棒（期限という「点」）、日付リマインドの菱形と並べても取り違えないよう、
 * 塗らない円にする。過ぎた時間を表す印なので、時計の文字盤に近い形を選んでいる。
 */
export function ActivityMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-full border-[1.5px] border-current opacity-85", className)}
    />
  );
}
