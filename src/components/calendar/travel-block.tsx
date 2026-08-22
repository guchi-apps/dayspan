"use client";

import { cn } from "@/lib/utils";
import { TRAVEL_MODE_LABELS, type TravelItem } from "@/types/calendar";

import { eventTextLines } from "./item-layout";
import { TravelMark } from "./travel-mark";

/**
 * 時間グリッドに置く移動の帯（docs/spec.md §29）。
 *
 * 予定と同じ幅で置き、左端の縦線・進行方向の斜め縞・矢印で見分ける。形を予定に寄せるのは、
 * 移動もその時間を実際に占有するため。色だけで分けると、Google側で青系の色を選んだ
 * カレンダーの予定と見分けが付かなくなる。
 *
 * 斜め縞は流さない。空き時間を引いている最中の枠（SlotRangeBlock）が流れる縞で
 * 「いま押さえているところ」を示しており、動きの有無でその2つを分けている。
 */
export function TravelBlock({
  travel,
  top,
  height,
  timeText,
  onOpen,
}: {
  travel: TravelItem;
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

  // 高さに収まる行数ぶんだけ添える。短い移動に詰め込むと文字が潰れる（予定と同じ考え方）。
  const textLines = eventTextLines(height);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "absolute inset-x-0 flex flex-col overflow-hidden rounded-item border border-l-[3px] border-travel/40 border-l-travel",
        "bg-travel-container/70 px-1.5 py-0.5 text-left text-[10px] leading-tight text-on-travel-container",
      )}
      style={{
        top,
        height,
        // 進行方向の斜め縞。塗りだけだと、淡い色の予定と面として見分けにくい。
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(0,0,0,.05) 0 6px, transparent 6px 12px)",
      }}
      title={`${timeText} ${travel.title}（${modeLabel} ${minutes}分）`}
    >
      <span className="clip-nowrap flex shrink-0 items-center gap-1 font-semibold">
        <TravelMark className="size-2 text-travel" />
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
