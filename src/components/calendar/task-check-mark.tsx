import { cn } from "@/lib/utils";

/**
 * カレンダー上でタスクを示す印（issue #573）。
 *
 * 以前は幅2px・高さ10pxの縦棒で「期限という点」を目盛りとして描いていた。意味は通っていたが、
 * 2pxは日付リマインドの菱形（6px）より小さく、印としては読まれていなかった。予定・移動・タスク・
 * 日付リマインドはどれも「角丸4pxの横長の枠に、時刻と名前」で形が同じなので、種別の判定は先頭の
 * 印にしか乗っていない。そこがいちばん小さいと、押して開くまで何なのか分からない。
 *
 * チェックボックスにすると、完了状態を持つのはタスクだけという区別（`docs/spec.md` §9。タスクと
 * 日付リマインドの違いはこの一点）がそのまま形になり、済んだかどうかも打ち消し線に頼らず読める。
 * 引き換えに項目名は約6px（全角0.6文字）縮む。ゴミの日をゴミ箱の線画にしたとき（issue #303）の
 * +4pxより大きいが、タスクは月表示のマスに毎日並ぶ種類なので、見分けに使う価値がある。
 *
 * 押しても従来どおりタスクの画面が開くだけで、その場では完了にしない。8pxの的は、期限を
 * ドラッグで動かす操作とまったく同じ面にあり、狙って押し分けられないため。
 *
 * 予定に紐づいたタスクは印が `TaskStageMark`（四角と点）に置き換わる。そちらは変えない。
 */
export function TaskCheckMark({
  done = false,
  planned = false,
  size = "sm",
}: {
  done?: boolean;
  /** 予定日の枠。締切ではなく見込みなので、枠の破線と同じく輪郭を薄くする。 */
  planned?: boolean;
  /** sm は月表示、md は終日エリアと時間グリッドの引き出し線。呼び出し側でpxを組み立てさせない。 */
  size?: "sm" | "md";
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className={cn(
        "shrink-0",
        size === "md" ? "size-2.5" : "size-2",
        done
          ? "text-on-surface-variant/55"
          : planned
            ? "text-primary/45"
            : "text-primary",
      )}
    >
      {/* 既定の線幅（1）では8pxにしたときに0.67pxまで細り、輪郭が地に溶ける（ゴミ箱と同じ扱い）。 */}
      <rect
        x="0.9"
        y="0.9"
        width="10.2"
        height="10.2"
        rx="2.4"
        fill={done ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {done && (
        <path
          d="M3.3 6.2 5.2 8.1 8.8 4.2"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          // チェックは塗りを抜いて出す。色数を増やさずに輪郭と線の境目を作る
          // （アプリアイコンの縦棒を背景色で抜いているのと同じ考え方）。
          className="stroke-surface-container-lowest"
        />
      )}
    </svg>
  );
}
