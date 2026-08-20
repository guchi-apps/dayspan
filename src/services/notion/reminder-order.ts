import type { ReminderItem } from "@/types/calendar";

import { sameDayOfYear } from "./reminders";

// 日付リマインドの専用一覧（/reminders）の並び（issue #288）。
//
// 一覧を開く理由は「次に何が来るか」を見ることなので、次に来る日の早い順に並べる。
// 毎年の項目にとって日付プロパティの年は登録した年でしかなく、その年で束ねると
// 誕生日のような古い起点の項目が一覧の先頭に沈む。
//
// 並べ替えをコンポーネントではなくサービス層に置くのは、将来API/MCPから同じ並びを
// 返せるようにするため（services/notion/task-buckets.ts と同じ位置づけ）。

/** 1件の項目と、その項目が次に来る日。 */
export type ReminderOccurrence = {
  item: ReminderItem;
  /** 次に来る日（YYYY-MM-DD）。過ぎた単発では、その項目自身の日付が入る。 */
  nextKey: string;
};

/** 月ごとの区分。見出しには月だけを出し、年は変わる位置にだけ添える。 */
export type ReminderMonthSection = {
  /** YYYY-MM。Reactのkeyに使う。 */
  key: string;
  year: number;
  month: number;
  items: ReminderOccurrence[];
};

export type ReminderSections = {
  /** 今日以降に来る項目。次に来る日の昇順。 */
  sections: ReminderMonthSection[];
  /** 過ぎた単発の項目。新しい順。毎年の項目は必ず次に来る日を持つため入らない。 */
  past: ReminderOccurrence[];
};

/**
 * その項目が次に来る日を求める。
 *
 * 毎年の項目は、今日以降で最初に来る同じ月日。今日と同じ月日なら今日。
 * 起点（sourceDate）が未来にある項目は起点の日そのものにする。登録した年より前には出さない、
 * というカレンダー側の決まり（services/notion/reminders.ts の expandAnnual）と揃える。
 *
 * 単発の項目は自分の日付をそのまま返す。毎年プロパティが未設定（annual が null）のものは、
 * 毎年かどうかが分からないため展開しない側＝単発として扱う。
 */
export function nextReminderDateKey(
  reminder: ReminderItem,
  todayKey: string,
  itemDateKey: (value: string) => string,
): string {
  // 起点は表示中の日付ではなく元ページの日付。毎年の項目をカレンダーから開いた場合でも
  // 同じ答えになるようにする。
  const baseKey = itemDateKey(reminder.sourceDate);
  if (!reminder.annual) return baseKey;

  const floor = baseKey > todayKey ? baseKey : todayKey;
  const month = baseKey.slice(5, 7);
  const day = baseKey.slice(8, 10);

  const year = Number(floor.slice(0, 4));
  const thisYear = sameDayOfYear(year, month, day);
  // 2/29の項目はうるう年でない年に2/28へ寄るため、寄せたあとの日付で比べる。
  return thisYear >= floor ? thisYear : sameDayOfYear(year + 1, month, day);
}

/** 次に来る日で並べる。同じ日はタイトルで決め、取得のたびに順番が入れ替わらないようにする。 */
function compareOccurrences(a: ReminderOccurrence, b: ReminderOccurrence): number {
  if (a.nextKey !== b.nextKey) return a.nextKey < b.nextKey ? -1 : 1;
  return a.item.title.localeCompare(b.item.title, "ja");
}

/**
 * 一覧に並べる区分を組み立てる。
 *
 * 過ぎた単発の項目は次に来る日を持たない。時系列の先頭へ置くと、いちばん見たい直近の項目が
 * その下に沈むため、末尾へ分けて畳めるようにする（タスク画面の完了と同じ考え方）。
 */
export function buildReminderSections(
  reminders: ReminderItem[],
  todayKey: string,
  itemDateKey: (value: string) => string,
): ReminderSections {
  const upcoming: ReminderOccurrence[] = [];
  const past: ReminderOccurrence[] = [];

  for (const item of reminders) {
    const nextKey = nextReminderDateKey(item, todayKey, itemDateKey);
    if (nextKey < todayKey) past.push({ item, nextKey });
    else upcoming.push({ item, nextKey });
  }

  upcoming.sort(compareOccurrences);
  past.sort((a, b) => -compareOccurrences(a, b));

  const sections: ReminderMonthSection[] = [];
  for (const occurrence of upcoming) {
    const key = occurrence.nextKey.slice(0, 7);
    const last = sections.at(-1);
    if (last && last.key === key) last.items.push(occurrence);
    else {
      sections.push({
        key,
        year: Number(key.slice(0, 4)),
        month: Number(key.slice(5, 7)),
        items: [occurrence],
      });
    }
  }

  return { sections, past };
}
