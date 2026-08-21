import { cn } from "@/lib/utils";
import { TASK_EVENT_STAGE_LABELS, type TaskEventStage } from "@/types/calendar";

/** 段階ごとの点の位置。四角（予定）の外・左 → 内・左 → 内・右 → 外・右 と並ぶ。 */
const DOT_X: Record<TaskEventStage, number> = {
  BEFORE_START: 1.6,
  DURING: 6.6,
  BEFORE_END: 9.4,
  AFTER_END: 14.4,
};

/**
 * カレンダー上で「予定に紐づくタスク」を示す印（docs/spec.md §31）。
 *
 * 日付リマインドの菱形・移動の矢印と同じく、形だけで見分けられる最小限の印にする。
 * 文字（前・中・後）にしないのは、9〜10pxの枠では1文字でも項目名の幅をその分奪ううえ、
 * 「終了まで」と「終了後」を1文字に縮めると読み分けられないため。
 *
 * 四角が予定、点がタスクの位置を表す。四角の外にあれば予定の前後、中にあれば予定の最中。
 */
export function TaskStageMark({
  stage,
  drifted = false,
  className,
}: {
  stage: TaskEventStage;
  /** 紐づけ先の予定が動いてずれているか。色を変えて、目を向ける先をここに寄せる。 */
  drifted?: boolean;
  className?: string;
}) {
  return (
    <svg
      role="img"
      aria-label={`予定の${TASK_EVENT_STAGE_LABELS[stage]}`}
      viewBox="0 0 16 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      className={cn("shrink-0", drifted ? "text-error" : "text-primary", className)}
    >
      <rect x="4.5" y="2.5" width="7" height="7" rx="1.5" />
      <circle cx={DOT_X[stage]} cy="6" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
