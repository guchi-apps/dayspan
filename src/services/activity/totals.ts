import type { GoogleEvent } from "@/services/google-calendar/events";
import type { ActivityTotalItem } from "@/types/activity";

/** 項目名の無い予定の見出し。Google側でタイトルを空のまま作った記録がここへ入る。 */
export const UNTITLED_ACTIVITY = "（名称なし）";

export type ActivityTotals = {
  totalMinutes: number;
  /** 項目名ごとの合計。長い順。件数は絞らず、表示側で必要なぶんだけ取る。 */
  items: ActivityTotalItem[];
  /** 直前に終わった記録。停止中のウィジェットに「最後は何を何時まで」を出すために使う。 */
  last: { title: string; endedAt: string } | null;
};

/**
 * 今日の記録を項目名ごとに合計する（docs/spec.md §28）。
 *
 * DB・外部APIに触れない純粋な計算にしてある。日をまたいだ記録の切り詰めと、記録中のぶんを
 * 足す条件が絡み合うため、取得と切り離して確かめられる形にしておく。
 */
export function summarizeActivityMinutes(input: {
  /** 保存先カレンダーの予定。範囲外のものが混ざっていても、ここで切り詰める。 */
  events: GoogleEvent[];
  /** 集計の開始（設定タイムゾーンでの今日0時）。 */
  dayStart: Date;
  /** 集計の終わり（現在時刻）。 */
  now: Date;
  /** 進行中の記録。まだGoogleには存在しないため、別に受け取って足す。 */
  running: { title: string; startedAt: string } | null;
}): ActivityTotals {
  const { events, dayStart, now, running } = input;

  const minutesByTitle = new Map<string, number>();
  let last: ActivityTotals["last"] = null;

  for (const event of events) {
    // 終日の予定は時間帯を持たない。記録は必ず時刻付きで作られる（running.ts）ため、
    // 終日で入っているものは手で足した別の予定とみなして数えない。
    if (!event.start?.dateTime || !event.end?.dateTime) continue;

    // 日付をまたいだ記録は今日にかかるぶんだけ数える。まだ来ていない時刻も数えない。
    const from = Math.max(new Date(event.start.dateTime).getTime(), dayStart.getTime());
    const to = Math.min(new Date(event.end.dateTime).getTime(), now.getTime());
    const minutes = Math.round((to - from) / 60_000);
    if (minutes <= 0) continue;

    add(minutesByTitle, event.summary, minutes);

    if (!last || to > new Date(last.endedAt).getTime()) {
      last = { title: title(event.summary), endedAt: new Date(to).toISOString() };
    }
  }

  // 記録中のぶんも足す。ウィジェットには経過時間が別に出ているため、合計に入れないと
  // 画面の数字どうしが食い違って見える。
  if (running) {
    const from = Math.max(new Date(running.startedAt).getTime(), dayStart.getTime());
    const minutes = Math.round((now.getTime() - from) / 60_000);
    if (minutes > 0) add(minutesByTitle, running.title, minutes);
  }

  const items = [...minutesByTitle.entries()]
    .map(([name, minutes]) => ({ title: name, minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title));

  return {
    totalMinutes: items.reduce((sum, item) => sum + item.minutes, 0),
    items,
    last,
  };
}

function add(minutesByTitle: Map<string, number>, summary: string | undefined, minutes: number) {
  const name = title(summary);
  minutesByTitle.set(name, (minutesByTitle.get(name) ?? 0) + minutes);
}

function title(summary: string | undefined): string {
  return summary?.trim() || UNTITLED_ACTIVITY;
}
