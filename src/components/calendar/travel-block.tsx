"use client";

import { cn } from "@/lib/utils";
import { TRAVEL_MODE_LABELS, type TravelItem } from "@/types/calendar";

import { eventColors } from "./calendar-color";
import { eventTextLines } from "./item-layout";
import { TravelMark } from "./travel-mark";

/**
 * 時間グリッドに置く移動の帯（docs/spec.md §29）。
 *
 * 塗り・枠線・角丸は通常の予定とまったく同じにする（issue #502）。背景は書き出し先カレンダーの
 * 色（`travel.color`）を予定と同じ`eventColors()`で解決して使う（issue #492）。
 *
 * 以前は、背景を予定と同じ色に揃えた代わりに左端の縦線・進行方向の斜め縞を固定の専用色（青緑）で
 * 重ね、形で予定と見分けられるようにしていた。ただし同じ「移動」カレンダーへ普通の予定として
 * 保存したものにはその縞が付かず、同じ場所へ同じつもりで入れたものが2通りの見た目で並んでいた。
 * 入力経路の違いを画面で区別する必要は無いため、縞と縦線をやめて予定と同じ塗りへ戻した。
 *
 * 移動だと分かるのはタイトル頭の矢印（`TravelMark`）だけになる。矢印は固定の専用色にせず
 * 文字色（`eventColors()`が背景の明るさから選んだ色）に乗せる。青緑のままだと、ブルーベリーの
 * ような濃い色のカレンダーで矢印だけが背景に沈み、移動だと分かる手掛かりが何も残らないため。
 */
export function TravelBlock({
  travel,
  left,
  top,
  height,
  timeText,
  onOpen,
}: {
  travel: TravelItem;
  /** 左端の活動記録レーンのぶん右へ寄せる（issue #327）。レーンが無い日は 0。 */
  left: number;
  top: number;
  height: number;
  /** 「08:20–09:00」。日をまたぐ移動でも、実際の出発・到着の時刻を出す。 */
  timeText: string;
  onOpen: () => void;
}) {
  const minutes = Math.max(
    1,
    Math.round((new Date(travel.end).getTime() - new Date(travel.start).getTime()) / 60_000),
  );
  const modeLabel = TRAVEL_MODE_LABELS[travel.mode];
  const colors = eventColors(travel.color);

  // 高さに収まる行数ぶんだけ添える。短い移動に詰め込むと文字が潰れる（予定と同じ考え方）。
  const textLines = eventTextLines(height);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "absolute right-0 flex flex-col overflow-hidden rounded-item border",
        "px-1.5 py-0.5 text-left text-[10px] leading-tight",
      )}
      style={{
        left,
        top,
        height,
        backgroundColor: colors.background,
        color: colors.foreground,
        borderColor: colors.border,
      }}
      title={`${timeText} ${travel.title}（${modeLabel} ${minutes}分）`}
    >
      <span className="clip-nowrap flex shrink-0 items-center gap-1 font-semibold">
        <TravelMark className="size-2" />
        <span className="clip-nowrap">{travel.title}</span>
      </span>
      {textLines > 1 && (
        <span className="clip-nowrap shrink-0 opacity-75">
          {modeLabel} {minutes}分{travel.estimated && "（目安）"}
        </span>
      )}
      {textLines > 2 && <span className="clip-nowrap shrink-0 opacity-75">{timeText}</span>}
    </button>
  );
}
