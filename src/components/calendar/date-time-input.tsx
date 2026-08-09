"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";

/**
 * 日付と時刻を別々の入力欄で受け取り、`datetime-local` と同じ `YYYY-MM-DDTHH:mm` を返す。
 *
 * 入力欄を1つにすると、スマートフォンでは日付と時刻を1つのピッカーでまとめて選ぶことになり、
 * 時刻だけを直したいときにも日付から辿らされる。欄を分けると直したい方だけをその場で選べる。
 */
export function DateTimeInput({
  id,
  dateLabel,
  timeLabel,
  value,
  onChange,
}: {
  id: string;
  dateLabel: string;
  timeLabel: string;
  /** `YYYY-MM-DDTHH:mm`。日付・時刻のどちらかが未入力の間は空文字。 */
  value: string;
  onChange: (value: string) => void;
}) {
  // 片方だけ入力された途中の状態は結合できず、呼び出し側へは空文字しか渡せない。
  // 入力済みの側を消さずに残すため、2つの欄の値はこの中で保持する。
  const [parts, setParts] = useState(() => toParts(value));

  // 開始を動かすと終了も追従するなど、呼び出し側が値を差し替えることがある。
  // 自分が渡した値と違うものが来たときだけ、外の値で入力欄を作り直す。
  if (value !== parts.source) setParts(toParts(value));

  const change = (date: string, time: string) => {
    const next = join(date, time);
    setParts({ source: next, date, time });
    onChange(next);
  };

  return (
    <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
      <Input
        id={`${id}-date`}
        label={dateLabel}
        type="date"
        value={parts.date}
        onChange={(e) => change(e.target.value, parts.time)}
      />
      <Input
        id={`${id}-time`}
        label={timeLabel}
        type="time"
        value={parts.time}
        onChange={(e) => change(parts.date, e.target.value)}
      />
    </div>
  );
}

function toParts(value: string) {
  return { source: value, date: value.slice(0, 10), time: value.slice(11, 16) };
}

function join(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}
