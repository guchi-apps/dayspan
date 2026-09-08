import { dayTone, weekdayLabel } from "@/lib/day-tone";
import {
  MINUTES_PER_NIGHT,
  NIGHT_START_MINUTES,
  formatSleepDiff,
  formatSleepMinutes,
  formatSleepShort,
  offsetToClock,
  type SleepNight,
} from "@/lib/sleep";
import { cn } from "@/lib/utils";

/**
 * 睡眠の横通しチャート（docs/spec.md §39）。
 *
 * 1行が1晩（12:00から翌12:00）で、横軸が24時間。時間グリッドが日をまたぐ睡眠を
 * 0時で切り詰めて2本の帯に割るのに対し、ここでは1回の睡眠が必ず1本の帯として通る。
 *
 * 描くだけの部品にしてある。行の組み立てと切り詰めは `src/lib/sleep.ts` に閉じており、
 * ここは受け取った分をそのまま百分率にする。
 */

/** 目盛りを立てる位置（行の12:00から数えた分）。3時間ごと。 */
const TICKS = [180, 360, 540, 720, 900, 1080, 1260];

/**
 * 時刻を書く位置。6時間ごと（12時・18時・0時・6時・12時）。
 *
 * 3時間ごとに書くと、幅390pxの端末では帯の入る幅が230px程度しか残らず、9つの見出しが
 * 重なる。目盛りの線は3時間ごとのまま残すので、その間の時刻も数えれば読める。
 */
const LABEL_TICKS = [0, 360, 720, 1080, MINUTES_PER_NIGHT];

/** 夜として淡く落とす範囲。18:00（+360）から翌9:00（+1260）まで。 */
const NIGHT_BAND = { from: 360, to: 1260 };

const percent = (minutes: number): string => `${(minutes / MINUTES_PER_NIGHT) * 100}%`;

export function SleepChart({
  nights,
  targetMinutes,
  todayKey,
}: {
  /** 古い順の行。 */
  nights: SleepNight[];
  targetMinutes: number;
  todayKey: string;
}) {
  return (
    <div className="flex flex-col">
      {/* 目盛りの見出し。行の左のラベル（w-14）と右の合計（w-14）を除いた幅に合わせる。
          絶対配置の基準はこの要素のパディングボックスなので、両端の 3.5rem を式で引く。 */}
      <div className="relative h-4">
        {LABEL_TICKS.map((tick) => (
          <span
            key={tick}
            className="type-label-small absolute -translate-x-1/2 whitespace-nowrap text-on-surface-variant"
            style={{ left: `calc(3.5rem + (100% - 7rem) * ${tick / MINUTES_PER_NIGHT})` }}
          >
            {clockHour(tick)}
          </span>
        ))}
      </div>

      <ul className="flex flex-col">
        {nights.map((night, index) => (
          <NightRow
            key={night.dateKey}
            night={night}
            targetMinutes={targetMinutes}
            today={night.dateKey === todayKey}
            last={index === nights.length - 1}
          />
        ))}
      </ul>

      <div className="type-label-small mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-14 text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-3.5 rounded-item bg-primary" aria-hidden />
          睡眠
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-3.5 rounded-item border border-dashed border-primary" aria-hidden />
          記録中
        </span>
        <span>目標 {formatSleepMinutes(targetMinutes)}</span>
      </div>
    </div>
  );
}

function NightRow({
  night,
  targetMinutes,
  today,
  last,
}: {
  night: SleepNight;
  targetMinutes: number;
  today: boolean;
  /** いちばん下の行。罫線で表を閉じるために受け取る（`last:` は親のli側にしか当たらない）。 */
  last: boolean;
}) {
  const tone = dayTone(night.dateKey);
  const diff = night.minutes - targetMinutes;
  const short = night.minutes > 0 && diff < 0;

  return (
    <li
      className={cn(
        "flex h-6 items-stretch",
        // 今日の行は淡く塗る。31行を上から追う面で、太字だけでは見つけにくい
        // （勤務の日別一覧の今日と同じ流儀）。
        today && "bg-primary/8",
      )}
    >
      <span
        className={cn(
          "type-label-small w-14 shrink-0 pl-0.5 leading-6",
          tone ?? "text-on-surface-variant",
        )}
      >
        {shortDateLabel(night.dateKey)}({weekdayLabel(night.dateKey)})
      </span>

      <div
        className={cn(
          "relative min-w-0 flex-1 border-t border-outline-variant",
          last && "border-b",
        )}
      >
        {/* 夜の帯。目盛りだけだと、帯がどのあたりの時刻にあるのか読むのに毎回目盛りを数える。 */}
        <i
          className="absolute inset-y-0 bg-primary/6"
          style={{ left: percent(NIGHT_BAND.from), width: percent(NIGHT_BAND.to - NIGHT_BAND.from) }}
          aria-hidden
        />

        {TICKS.map((tick) => (
          <i
            key={tick}
            className={cn(
              "absolute inset-y-0 w-px",
              tick === 720 ? "bg-outline" : "bg-outline-variant/50",
            )}
            style={{ left: percent(tick) }}
            aria-hidden
          />
        ))}

        {night.segments.map((segment, index) => (
          <i
            key={index}
            className={cn(
              "absolute inset-y-1 rounded-item",
              segment.running
                ? "border border-dashed border-primary bg-primary/25"
                : "bg-primary",
            )}
            style={{ left: percent(segment.from), width: percent(segment.to - segment.from) }}
            title={`${offsetToClock(segment.from)}–${offsetToClock(segment.to)}${segment.running ? "（記録中）" : ""}`}
            aria-hidden
          />
        ))}
      </div>

      <span className="type-label-small w-14 shrink-0 pr-0.5 text-right leading-6">
        {night.minutes === 0 ? (
          <span className="text-on-surface-variant">—</span>
        ) : (
          <>
            <span className="font-bold">{formatSleepShort(night.minutes)}</span>
            {/* 色だけに意味を持たせない。足りていないことは読み上げにも残す。 */}
            <span className={cn("ml-1", short ? "text-error" : "text-on-surface-variant")}>
              {formatSleepDiff(diff)}
            </span>
          </>
        )}
      </span>

      {/* 帯そのものは読み上げられないため、行の内容を1文にして添える。 */}
      <span className="sr-only">
        {night.minutes === 0
          ? night.complete
            ? "記録なし"
            : "今夜はこれから"
          : `${formatSleepMinutes(night.minutes)}。${
              night.segments.length > 0
                ? `${offsetToClock(night.segments[0].from)}から${offsetToClock(night.segments[night.segments.length - 1].to)}まで。`
                : ""
            }目標より${formatSleepMinutes(Math.abs(diff))}${diff < 0 ? "少ない" : "多い"}`}
      </span>
    </li>
  );
}

/** 目盛りの見出し（12時・15時…）。行の12:00から数えた分を時計の時へ直す。 */
function clockHour(offset: number): string {
  return `${Math.floor(((offset + NIGHT_START_MINUTES) % MINUTES_PER_NIGHT) / 60)}時`;
}

/** 行のラベル（9/7）。年は月の見出しに出るため行には入れない。 */
function shortDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}
