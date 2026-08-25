import { Briefcase } from "lucide-react";

import { tagChipClass, tagColorOf } from "@/components/tags/tag-color";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import type { WorkRecordItem } from "@/types/work";

/**
 * カレンダーに出す勤務場所（docs/spec.md §34）。
 *
 * 勤務場所は1日1件で、時刻も長さも持たない「その日そのものの属性」。予定・タスク・移動が並ぶ面へ
 * 混ぜると、毎日必ず1件あるぶんだけ月表示の段と終日エリアが埋まる。Google Calendarへ書き出さないと
 * 決めた理由（§34）がそのままDaySpanの中で起きるため、項目としてではなく日付の見出しへ添える。
 *
 * 押せる印にはしない。日付の見出しを押したときの行き先は「その日の1日表示へ移動」で既に決まっており、
 * そこへ別の行き先を重ねると、日を開くつもりの操作が入力画面になる。登録・修正は勤務の画面に閉じる。
 */
export function WorkPlaceChip({
  record,
  options,
  className,
}: {
  record: WorkRecordItem;
  /** 勤務場所の選択肢。色はNotionのselectのプロパティ定義が一次情報源（docs/spec.md §34）。 */
  options: TagOption[];
  className?: string;
}) {
  const label = workPlaceLabel(record);
  if (!label) return null;

  return (
    <span
      // 押せる印にはしないため、日のセル全体を覆う「1日表示へ移動」のボタンへ押下を通す。
      className={cn(
        "pointer-events-none inline-flex min-w-0 items-center gap-[3px] overflow-hidden rounded-full px-1 text-[10px] leading-[15px] font-medium whitespace-nowrap",
        tagChipClass(tagColorOf(options, record.place ?? "")),
        className,
      )}
    >
      {/* 出張の勤務場所には行き先（「大阪」）が入るため、名前だけでは通常の勤務と区別が付かない。 */}
      {record.businessTrip && <Briefcase aria-hidden className="size-2.5 shrink-0" />}
      {/*
        色だけに意味を持たせない（狭い列では名前が端から切れて色だけが残る）。
        読み上げには何の値なのかまで残す。
      */}
      <span className="sr-only">{record.businessTrip ? "出張" : "勤務場所"}</span>
      <span className="overflow-hidden">{label}</span>
    </span>
  );
}

/**
 * チップに出す文字列。
 *
 * 通常の勤務は勤務場所そのもの（勤務の画面はタイトルにも同じ値を入れる）。出張はタイトルに
 * 行き先が入っており、そちらのほうが「どこへ行っているか」を示す。
 */
export function workPlaceLabel(record: WorkRecordItem): string {
  const label = record.businessTrip ? record.title : (record.place ?? record.title);
  return label.trim();
}

/**
 * 日付キーから勤務記録を引ける形にする。
 *
 * 出張は期間の全ての日にかかるため、かかる日すべてへ同じ記録を置く。1日1件（重なりは
 * 保存時に断っている・docs/spec.md §34）なので、同じ日に2件入ることはない。
 * 取得側で期間の下限を切っているため（services/notion/work-logs.ts）、展開する日数も有限。
 */
export function workRecordsByDate(records: WorkRecordItem[]): Map<string, WorkRecordItem> {
  const byDate = new Map<string, WorkRecordItem>();

  for (const record of records) {
    if (record.endDate < record.startDate) continue;

    let cursor = parseDateKey(record.startDate);
    let dateKey = record.startDate;

    // 壊れた日付で伸び続けないよう上限を置く（月表示の窓は前後1ヶ月ぶんしか持たない）。
    for (let index = 0; index < 400 && dateKey <= record.endDate; index += 1) {
      byDate.set(dateKey, record);
      cursor = addDays(cursor, 1);
      dateKey = toDateKey(cursor);
    }
  }

  return byDate;
}
