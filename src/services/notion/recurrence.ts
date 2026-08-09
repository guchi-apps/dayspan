// 繰り返しタスクの次回期限を計算する（docs/spec.md §13）。
// Notionのselectプロパティ1つで表現するため、曜日指定は「毎週(月・水・金)」の形で名前に埋め込む。

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export type Recurrence =
  | { type: "none" }
  | { type: "daily" }
  | { type: "weekly"; weekdays: number[] }
  | { type: "monthly" }
  | { type: "yearly" };

export function parseRecurrence(value: string | null | undefined): Recurrence {
  if (!value || value === "なし") return { type: "none" };
  if (value === "毎日") return { type: "daily" };
  if (value === "毎月") return { type: "monthly" };
  if (value === "毎年") return { type: "yearly" };

  if (value.startsWith("毎週")) {
    const match = value.match(/^毎週[(（](.+)[)）]$/);
    if (!match) return { type: "weekly", weekdays: [] };

    const weekdays = match[1]
      .split(/[・,、]/)
      .map((label) => WEEKDAY_LABELS.indexOf(label.trim()))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);

    return { type: "weekly", weekdays };
  }

  return { type: "none" };
}

export function formatRecurrence(recurrence: Recurrence): string {
  switch (recurrence.type) {
    case "none":
      return "なし";
    case "daily":
      return "毎日";
    case "monthly":
      return "毎月";
    case "yearly":
      return "毎年";
    case "weekly":
      if (recurrence.weekdays.length === 0) return "毎週";
      return `毎週(${recurrence.weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")})`;
  }
}

/**
 * 次回の期限を返す。時刻部分は元の期限のまま維持する。
 * 期限が無いタスクは次回を作れないため null を返す。
 */
export function nextDue(due: string | null, recurrence: Recurrence): string | null {
  if (!due || recurrence.type === "none") return null;

  const hasTime = due.includes("T");
  const datePart = due.slice(0, 10);
  const rest = hasTime ? due.slice(10) : "";

  // 日付だけをUTC正午で扱い、タイムゾーンによる日付ずれを避ける。
  const base = new Date(`${datePart}T12:00:00Z`);

  switch (recurrence.type) {
    case "daily":
      base.setUTCDate(base.getUTCDate() + 1);
      break;
    case "weekly": {
      if (recurrence.weekdays.length === 0) {
        base.setUTCDate(base.getUTCDate() + 7);
        break;
      }
      // 指定曜日のうち、現在の期限より後で最も近いものへ進める。
      for (let offset = 1; offset <= 7; offset += 1) {
        const candidate = new Date(base);
        candidate.setUTCDate(candidate.getUTCDate() + offset);
        if (recurrence.weekdays.includes(candidate.getUTCDay())) {
          base.setTime(candidate.getTime());
          break;
        }
      }
      break;
    }
    case "monthly": {
      const day = base.getUTCDate();
      base.setUTCDate(1);
      base.setUTCMonth(base.getUTCMonth() + 1);
      // 31日 → 翌月に31日が無い場合は月末に丸める。
      const lastDay = new Date(
        Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 12),
      ).getUTCDate();
      base.setUTCDate(Math.min(day, lastDay));
      break;
    }
    case "yearly": {
      const month = base.getUTCMonth();
      const day = base.getUTCDate();
      base.setUTCFullYear(base.getUTCFullYear() + 1);
      // 2/29 → 翌年に無い場合は2/28へ丸める。
      if (base.getUTCMonth() !== month) base.setUTCDate(0);
      else if (base.getUTCDate() !== day) base.setUTCDate(day);
      break;
    }
  }

  const nextDate = base.toISOString().slice(0, 10);
  return hasTime ? `${nextDate}${rest}` : nextDate;
}

export const RECURRENCE_PRESETS = ["なし", "毎日", "毎週", "毎月", "毎年"];
