"use client";

import type { CalendarEventItem } from "@/types/calendar";

import { ActivityMark } from "./activity-mark";
import { subduedEventColors } from "./calendar-color";

/**
 * 時間グリッドの左端のレーンへ置く活動記録（issue #327）。
 *
 * 記録は後から見返す事実で、これから動くために見る予定とは読む理由が違う（docs/spec.md §27）。
 * 予定と同じ幅で置くと、睡眠のような長い記録が入った日は時間グリッドがほぼ記録の面になり、
 * 同じ時間帯の予定・移動がその半分へ押し込まれる。占めていた時間は帯の高さで残したまま、
 * 幅だけをレーンへ譲る。
 *
 * 項目名は縦書きで流す。日本語は縦に組んでも読めるため、16pxの帯でも「睡眠」「仕事」が
 * 開かずに読める。色は記録用カレンダー1つぶんしか無く、帯だけでは何の記録か分からないため。
 */
export function ActivityLaneBlock({
  event,
  top,
  height,
  left,
  width,
  timeText,
  onOpen,
}: {
  event: CalendarEventItem;
  top: number;
  height: number;
  left: number;
  width: number;
  /** 「03:03–10:03」。日をまたぐ記録でも、実際の開始・終了の時刻を出す。 */
  timeText: string;
  onOpen: () => void;
}) {
  const colors = subduedEventColors(event.color);

  // 記録どうしが重なる日はレーンの中をさらに分けるため、1件あたりの幅が半分以下になる。
  // 縦書きの文字が通らない幅では帯だけにする（欠けた文字を出すより読めないことが分かる）。
  const showTitle = width >= 14;

  return (
    <button
      type="button"
      onClick={onOpen}
      // 幅が足りず項目名を出さないときは、枠の中に読み上げられる文字が残らない。
      aria-label={`${timeText} ${event.title}`}
      className="absolute flex flex-col items-center gap-0.5 overflow-hidden rounded-item border border-l-[3px] py-0.5 text-on-surface"
      style={{
        top,
        height,
        left,
        width,
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderLeftColor: colors.accent,
      }}
      title={`${timeText} ${event.title}`}
    >
      <ActivityMark className="size-1.5" />
      {showTitle && (
        <span
          className="min-h-0 overflow-hidden text-[9px] leading-none font-semibold"
          // 縦書きはTailwindのユーティリティに無いため直接指定する。
          // text-orientation を mixed にすると、英数字だけが90度回って和文はそのまま立つ。
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {event.title}
        </span>
      )}
    </button>
  );
}
