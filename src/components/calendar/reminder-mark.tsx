import { Trash } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ReminderItem } from "@/types/calendar";

/**
 * カレンダー上で日付リマインドとゴミの日を示す印。
 *
 * 日付リマインドは菱形。ベルのアイコンは輪郭を読ませるために一定の大きさが要り、項目名に使える幅を
 * その分奪っていた。枠の高さは9〜10pxの文字に合わせてあり、削られるのはたいてい項目名のほうなので、
 * 形だけで見分けられる最小限の印に置き換えている（issue #171）。タスクの縦棒（期限という「点」）と
 * 取り違えないよう、菱形にして向きで分ける。
 *
 * ゴミの日だけはゴミ箱の形にする。上の「形だけで足りる」が成り立つのは、項目名がそのまま何の項目かを
 * 示す場合まで。ゴミの日は「普通ごみ」「資源ごみ」といった品目名を読むまでゴミの日だと分からず、
 * 週に2〜3件入るため読む手間がそのぶん積み上がっていた（issue #303）。ここでは輪郭に幅を割く。
 *
 * 品目ごとには分けない。Notionへ渡るのは品目名の文字列だけで、種類は常に「ゴミの日」のため、
 * どの品目かは名前が示す。
 */
export function ReminderMark({
  source,
  size = "sm",
}: {
  source: ReminderItem["source"];
  /** sm は月表示・引き出し線の枠、md は終日エリアの枠。呼び出し側でpxを組み立てさせない。 */
  size?: "sm" | "md";
}) {
  // ゴミ箱は輪郭を読ませる必要があり、菱形と同じ6pxでは形が潰れる。項目名から奪う幅は4pxで、
  // 品目名は「普通ごみ」のように短いため飲める。色は菱形と同じ tertiary に留め、
  // 日付リマインドと同じ系統の中で形だけを分ける。
  //
  // 削除ボタンと同じ図柄になるが、押せない枠の中の記号とダイアログの押せるボタンで面が違い、
  // ゴミの日の詳細には削除ボタン自体を出していないため、同じ画面に2つの意味では並ばない。
  // Trash2（内側に縦線2本）ではなく Trash を使うのは、10pxでは内側の線が潰れて輪郭を濁らせるため。
  if (source === "garbage") {
    return (
      <Trash
        aria-hidden
        strokeWidth={2.25}
        className={cn("shrink-0 text-tertiary", size === "md" ? "size-3" : "size-2.5")}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn("shrink-0 rotate-45 bg-tertiary", size === "md" ? "size-2" : "size-1.5")}
    />
  );
}
