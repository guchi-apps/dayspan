/**
 * 日本の国民の祝日。
 *
 * 外部から取りに行かず、年から計算して求める。祝日は法律で日付が決まっており、
 * 取りに行くもの（Google Calendarの祝日カレンダー）にすると画面を開くたびに往復が増える
 * （docs/spec.md §20）。利用者が祝日カレンダーを購読しているとも限らない。
 * サーバーとブラウザで同じ答えが出る必要もある（片方だけ色が付くとハイドレーションが一致しない）。
 *
 * 対象は 2007〜2099 年。春分・秋分は近似式が成り立つ範囲（1980〜2099）に依り、
 * 振替休日は2007年の改正後の規定（日曜と重なったら次の平日）で数えるため、
 * それより前の年は祝日なしとして返す。DaySpanで扱う勤務の記録は使い始めて以降のもので、
 * 過去へさかのぼる先もその範囲に収まる。
 */

/** 日付キー（YYYY-MM-DD）→ 祝日の名前。 */
type HolidayMap = Map<string, string>;

const FIRST_YEAR = 2007;
const LAST_YEAR = 2099;

/** 年ごとの計算結果。月を送るたびに同じ年を組み直さないよう持っておく。 */
const cache = new Map<number, HolidayMap>();

/** その日が祝日なら名前、そうでなければ null。 */
export function japaneseHolidayName(dateKey: string): string | null {
  const year = Number(dateKey.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return japaneseHolidays(year).get(dateKey) ?? null;
}

/** その年の祝日。日付キーの昇順。 */
export function japaneseHolidays(year: number): HolidayMap {
  const cached = cache.get(year);
  if (cached) return cached;

  const holidays = buildYear(year);
  cache.set(year, holidays);
  return holidays;
}

function buildYear(year: number): HolidayMap {
  if (year < FIRST_YEAR || year > LAST_YEAR) return new Map();

  // 法律で日付が決まっている「国民の祝日」そのもの。振替休日・国民の休日はここから導く。
  const base: HolidayMap = new Map();
  const add = (month: number, day: number, name: string) => {
    base.set(dateKey(year, month, day), name);
  };

  add(1, 1, "元日");
  add(1, nthMonday(year, 1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  // 天皇誕生日は2019年に不在（前の陛下の12月23日が2018年まで、2月23日は2020年から）。
  if (year >= 2020) add(2, 23, "天皇誕生日");
  else if (year <= 2018) add(12, 23, "天皇誕生日");
  add(3, equinoxDay(year, 3), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  // 2020・2021年は東京オリンピック・パラリンピックに合わせて海の日・山の日・スポーツの日を移した。
  if (year === 2020) add(7, 23, "海の日");
  else if (year === 2021) add(7, 22, "海の日");
  else add(7, nthMonday(year, 7, 3), "海の日");
  if (year >= 2016) {
    if (year === 2020) add(8, 10, "山の日");
    else if (year === 2021) add(8, 8, "山の日");
    else add(8, 11, "山の日");
  }
  add(9, nthMonday(year, 9, 3), "敬老の日");
  add(9, equinoxDay(year, 9), "秋分の日");
  const sportsName = year >= 2020 ? "スポーツの日" : "体育の日";
  if (year === 2020) add(7, 24, sportsName);
  else if (year === 2021) add(7, 23, sportsName);
  else add(10, nthMonday(year, 10, 2), sportsName);
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");
  // 2019年の代替わりに伴う一日限りの祝日（4月30日・5月2日は国民の休日として下で導かれる）。
  if (year === 2019) {
    add(5, 1, "天皇の即位の日");
    add(10, 22, "即位礼正殿の儀の行われる日");
  }

  // 前後を祝日に挟まれた平日は国民の休日（シルバーウィークの9月22日など）。
  // 挟む側は「国民の祝日」そのものに限られるため、振替休日を足す前に数える。
  const result: HolidayMap = new Map(base);
  for (const key of [...base.keys()]) {
    const gap = shiftDate(key, 1);
    if (base.has(gap) || result.has(gap)) continue;
    if (weekdayOf(gap) === 0) continue;
    if (base.has(shiftDate(gap, 1))) result.set(gap, "国民の休日");
  }

  // 日曜と重なった祝日は、その後いちばん近い祝日でない日が振替休日になる。
  for (const key of [...base.keys()].sort()) {
    if (weekdayOf(key) !== 0) continue;
    let substitute = shiftDate(key, 1);
    while (result.has(substitute)) substitute = shiftDate(substitute, 1);
    result.set(substitute, "振替休日");
  }

  return new Map([...result.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * 春分の日・秋分の日。1980〜2099年で成り立つ近似式（国立天文台の暦要項に基づく通説の式）。
 */
function equinoxDay(year: number, month: 3 | 9): number {
  const base = month === 3 ? 20.8431 : 23.2488;
  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** その月の第n月曜日の日。ハッピーマンデーの祝日に使う。 */
function nthMonday(year: number, month: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((8 - first) % 7) + (nth - 1) * 7;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** UTCで組み立てて、実行環境のローカル時刻に依存させない（work-screen の weekdayOf と同じ理由）。 */
function weekdayOf(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

function shiftDate(key: string, days: number): string {
  const shifted = new Date(`${key}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
