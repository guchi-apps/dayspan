import { Briefcase } from "lucide-react";

import { tagChipClass, tagColorOf } from "@/components/tags/tag-color";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import { annualLeaveDays, COMPANY_HOLIDAY_TITLE, type WorkRecordItem } from "@/types/work";

/**
 * カレンダーに出す勤務場所（docs/spec.md §34）。
 *
 * 勤務場所は1日1件で、時刻も長さも持たない「その日そのものの属性」。予定・タスク・移動が並ぶ面へ
 * 混ぜると、毎日必ず1件あるぶんだけ月表示の段と終日エリアが埋まる。Google Calendarへ書き出さないと
 * 決めた理由（§34）がそのままDaySpanの中で起きるため、項目としてではなく日付の見出しへ添える。
 *
 * 押せる印にはしない。日付の見出しを押したときの行き先は「その日の1日表示へ移動」で既に決まっており、
 * そこへ別の行き先を重ねると、日を開くつもりの操作が入力画面になる。登録・修正は勤務の画面に閉じる。
 *
 * 名前は残った幅ぶんだけ出すが、**文字の途中では切らない**（issue #406）。1文字ずつ折り返させ、
 * 1行ぶんの高さ（`leading-[15px]`）で隠すことで、入る文字だけが丸ごと残る。pxで切ると、
 * スマートフォンの月表示（チップに残るのは約21px）で2文字目が数pxだけ顔を出した形で切れ、
 * 色も形も壊れて見えた。置き場所の側は `@container` にしておく必要がある。
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
      {/*
        出張の勤務場所には行き先（「大阪」）が入るため、名前だけでは通常の勤務と区別が付かない。
        印そのものも入らない幅（余白8px＋印10px）では落とす。印は縮まないため、残すと外側の
        `overflow-hidden` が印の右端を削り、直そうとしている見え方がそのまま印で起きる。
      */}
      {record.businessTrip && <Briefcase aria-hidden className="size-2.5 shrink-0 @max-[18px]:hidden" />}
      {/*
        色だけに意味を持たせない（1文字も入らない幅では名前を出さず色と印だけが残る）。
        読み上げには何の値なのかと名前の全体まで残す。見えている名前のほうは目のための
        ものとして読み上げから外す（幅で消えるのは見えている側だけにする）。
      */}
      <span className="sr-only">
        {record.companyHoliday
          ? COMPANY_HOLIDAY_TITLE
          : record.annualLeave
            ? "年休"
            : record.businessTrip
              ? "出張"
              : "勤務場所"}{" "}
        {label}
      </span>
      <span
        aria-hidden
        className={cn(
          "h-[15px] min-w-0 overflow-hidden break-all whitespace-normal",
          nameHiddenClass(record),
        )}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * 1文字ぶんも入らない幅で、名前ごと出さないための指定（issue #406）。
 *
 * 名前は1行ぶんの高さで切っており、切れ目は必ず文字と文字の境目に来る。ただし残り幅が
 * 1文字（10px）に満たないところでは、1文字目そのものが数pxだけ欠けて出る。判定は画面幅では
 * なく**チップに残っている幅**で行う（列の幅は表示形式と画面幅の掛け算で決まるため、
 * ブレークポイントで切るとPCの月表示のような幅のある列でも名前が消える・docs/spec.md §34）。
 *
 * 境目はチップの中身の幅から決まる。左右の余白が4pxずつ、文字が10px、出張はさらに印10pxと
 * 間隔3px。出張で名前ではなく印を残すのは、行き先（「大阪」）は名前だけでは通常の勤務と
 * 区別が付かず、区別を持っているのが印のほうだから（§34）。
 */
function nameHiddenClass(record: WorkRecordItem): string {
  return record.businessTrip ? "@max-[31px]:hidden" : "@max-[18px]:hidden";
}

/**
 * 幅ごとの見え方（余白8px・文字10px・印10px＋間隔3px から決まる）。
 *
 * | チップに残る幅 | 通常の勤務 | 出張 |
 * |---|---|---|
 * | 31px以上 | 入る文字だけ | 印＋入る文字だけ |
 * | 18〜31px | 入る文字だけ | 印だけ |
 * | 18px未満 | 色だけ | 色だけ |
 *
 * 18px未満になるのは、月表示のうち月の変わり目の日（数字が `9/1` のように広がる）くらい。
 */

/**
 * チップに出す文字列。
 *
 * 通常の勤務は勤務場所そのもの（勤務の画面はタイトルにも同じ値を入れる）。出張はタイトルに
 * 行き先が入っており、そちらのほうが「どこへ行っているか」を示す。
 *
 * 年休はタイトル（「年休（午前半休）」）をそのまま出すと、10pxの狭い列では末尾から切れて
 * 括弧の途中で終わる。全休は「年休」まで、半休は区分と残り半日の勤務場所を出す（勤務場所だけ
 * にすると年休だと分からず、区分だけにするとその日出社したことが消える）。
 *
 * 会社休業日は名称（「夏季休業」）があればそれを出す。名称を入れずに登録した記録は
 * タイトルが「会社休業日」で、狭い列では「会社」までしか入らず何の日か読めないため「休業」にする。
 */
export function workPlaceLabel(record: WorkRecordItem): string {
  if (record.companyHoliday) {
    return record.title && record.title !== COMPANY_HOLIDAY_TITLE ? record.title.trim() : "休業";
  }
  if (record.annualLeave) {
    if (annualLeaveDays(record.annualLeave) === 1) return "年休";
    return record.place ? `${record.annualLeave}・${record.place}` : record.annualLeave;
  }
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
