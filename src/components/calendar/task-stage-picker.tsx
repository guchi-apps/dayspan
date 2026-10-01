"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TASK_EVENT_STAGES, TASK_EVENT_STAGE_LABELS, TRAVEL_TASK_STAGE_LABELS, type TaskEventStage } from "@/types/calendar";

import { TaskStageMark } from "./task-stage-mark";

/**
 * 予定のどの段階でやるかを選ぶ（docs/spec.md §31）。
 *
 * 紐づけを作る画面と、紐づけ済みのタスクの表示画面の両方で使う。並び順は予定の時間軸と
 * 同じ「開始まで → 実施中 → 終了まで → 終了後」で固定する。押した段階がどこを指すのかは
 * 印（四角と点）で示す。
 */
export function TaskStagePicker({
  value,
  disabled = false,
  label = "いつやるか",
  travel = false,
  onChange,
}: {
  value: TaskEventStage;
  disabled?: boolean;
  label?: string;
  /** 移動に紐づけるとき、段階を出発・到着の呼び名にする（issue #914）。 */
  travel?: boolean;
  onChange: (stage: TaskEventStage) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1">
        {TASK_EVENT_STAGES.map((stage) => {
          const selected = stage === value;

          return (
            <Button
              key={stage}
              type="button"
              variant={selected ? "secondary" : "outline"}
              size="sm"
              disabled={disabled}
              className={cn(selected && "text-on-secondary-container")}
              onClick={() => onChange(stage)}
            >
              <TaskStageMark stage={stage} className="h-3 w-4" />
              {(travel ? TRAVEL_TASK_STAGE_LABELS : TASK_EVENT_STAGE_LABELS)[stage]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
