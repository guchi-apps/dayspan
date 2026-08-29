import type { TravelEstimate } from "@/lib/ai-travel-estimate";
import { formatQuotaDate, isQuotaExhausted, type TransitQuota } from "@/lib/transit-quota";
import type { YahooTransitRoute } from "@/lib/yahoo-transit-route";
import type { TravelEstimateSource, TravelMode } from "@/types/calendar";

/**
 * 所要時間の区画に出す文言（docs/spec.md §29）。
 *
 * JSXから分けているのは、出どころの組み合わせで言い分ける規則がここにしか無いため。
 * 部品の中に混ぜると、規則だけを読むにも動かすにもコンポーネントを通ることになる。
 */

/** 経路検索の提供元。NAVITIMEの利用規約が、提供元を明示することを求めている。 */
export type EstimateAttribution = { provider: string; termsUrl: string | null };

export const AI_NOTE = "所要時間はAIによる目安です。時刻表や道路状況は見ていません。";

/**
 * Yahoo!乗換案内から取り込んだときの注記。
 *
 * **「目安」「平均」とは書かない。** AIの見積もりも経路検索も推定値だが、これは利用者が
 * 実際のダイヤの中から選んだ列車そのもの。同じ言い方にすると、どちらも同じ確からしさに読める。
 */
export const YAHOO_NOTE = "Yahoo!乗換案内で選んだ経路の時刻です。";

/** 電車で、まだ何も取り込んでいないときの案内。押す前に手順が分かるようにする。 */
export const YAHOO_HOW_TO =
  "Yahoo!乗換案内で経路を選び、共有 ▸ コピーしてから取り込みます。";

/**
 * 候補を出す前・選んだあとの注記。
 *
 * **押す前から出どころを名乗る。** 押してから初めて「これは何の数字か」を考えることに
 * ならないようにするため。電車以外はAIの見積もりで、使えるかは押してみないと分からない
 * （未接続・座標なしのいずれでも候補が0件になる）ので断定しない。電車はYahoo!乗換案内から
 * 取り込む1本だけなので、押す前に手順そのものを書く。
 */
export function estimateNote(
  source: TravelEstimateSource,
  mode: TravelMode,
  attribution: EstimateAttribution | null,
): string {
  if (source === "YAHOO") return YAHOO_NOTE;
  if (source === "TRANSIT") return transitNote(attribution);
  if (source === "AI") return AI_NOTE;
  // 電車は経路検索・AIを出さず、Yahoo!乗換案内から取り込む（docs/spec.md §29）。
  // 既存の移動を開き直したときは上の分岐で出どころが出るため、ここは手入力のときだけ通る。
  if (mode === "TRAIN") return YAHOO_HOW_TO;
  return AI_NOTE;
}

/** 候補が並んでいるときの注記。実データとAIの目安で言い分ける。 */
export function resultNote(
  estimates: TravelEstimate[],
  attribution: EstimateAttribution | null,
): string {
  return estimates.some((estimate) => estimate.source === "transit")
    ? transitNote(attribution)
    : AI_NOTE;
}

/**
 * 経路検索の注記。
 *
 * **平均所要時間だと必ず断る。** 返るのは乗換の待ち時間を平均で見込んだ標準的な経路で、
 * 時刻表上の特定の列車ではない（電車時刻表データはNAVITIMEのオプション契約が要り、
 * APIマーケット経由では使えない）。出発時刻まで入るぶん確定したダイヤだと受け取られやすい。
 */
export function transitNote(attribution: EstimateAttribution | null): string {
  // 提供元は trainroute が添えてくる。取れなかったときに名前を作らず、
  // 「◯◯ の経路検索」の◯◯ごと落とす（「経路検索 の経路検索」にしない）。
  const source = attribution ? `${attribution.provider} の経路検索` : "経路検索";
  return `${source}による平均所要時間です。特定の列車の時刻ではありません。`;
}

/**
 * 経路の内訳。乗換・徒歩・運賃を1行に流す。
 *
 * 徒歩の分数を出すのは、渡しているのが座標だから。座標がずれていれば徒歩区間が伸び、
 * そこで気付ける。運賃は選ぶ手掛かりとして出すだけで、DaySpanには保存しない。
 * ICと通常の運賃が両方あるときはICを採る（実際に払う額に近いため）。
 */
export function transitDetail(transit: NonNullable<TravelEstimate["transit"]>): string {
  const parts = [transit.transitCount > 0 ? `乗換${transit.transitCount}回` : "乗換なし"];
  if (transit.walkMinutes > 0) parts.push(`徒歩${transit.walkMinutes}分`);
  if (transit.fare) parts.push(`¥${transit.fare.ic ?? transit.fare.ticket}`);
  return parts.join(" ・ ");
}

/**
 * 経路検索の残り回数の1行（docs/spec.md §29「経路検索の利用状況」）。
 *
 * **使い切っているときは、AIの目安になった理由を出す。** これが無いと、前回まで実データで
 * 出ていた電車の所要時間が黙って目安に戻り、値が変わった理由が画面のどこにも出ない。
 * 枠が残っていて単に取れなかったとき（座標が引けない・trainrouteが応答しない）は出さず、
 * `estimateNote()` の「調べられないときはAIの目安を出します」のままにする。理由を偽らないため。
 */
export function quotaNote(quota: TransitQuota | null, timeZone: string): string | null {
  if (!quota) return null;

  const resetDate = formatQuotaDate(quota.resetAt, timeZone);

  if (isQuotaExhausted(quota)) {
    const reset = resetDate ? `${resetDate}にリセットされます。` : "";
    return `${quota.label}の枠を使い切ったため、AIによる目安を出しています。${reset}`;
  }

  const reset = resetDate ? `・${resetDate}にリセット` : "";
  return `${quota.label}の経路検索は残り${quota.remaining}回${reset}`;
}

/**
 * 表示画面で所要時間に添える出どころ（docs/spec.md §29）。
 *
 * 手入力のときは何も添えない（`TravelItem.estimated` が false になり、呼び出し元が出さない）。
 */
export function estimateSourceLabel(source: TravelEstimateSource): string {
  if (source === "YAHOO") return "（Yahoo!乗換案内）";
  if (source === "TRANSIT") return "（経路検索の平均）";
  return "（AIによる目安）";
}

/**
 * Yahoo!乗換案内から取り込んだ直後の報せ（docs/spec.md §29）。
 *
 * 分数は「所要時間 48分」ではなく、入った時刻から計算する。画面に出る数字と保存される値が
 * 食い違わないようにするため（Yahoo!側の表記が丸められていても、正は入った時刻）。
 *
 * **検索日が移動の日と違うことは必ず伝える。** 日付そのものは動かさないため、黙っていると
 * 別の日のダイヤで出た時刻が入ったことに気付けない。
 */
export function yahooImportNote(
  route: YahooTransitRoute,
  departAt: string,
  arriveAt: string,
  baseDate: string,
): string {
  const minutes = Math.max(
    1,
    Math.round((Date.parse(`${arriveAt}:00Z`) - Date.parse(`${departAt}:00Z`)) / 60_000),
  );

  const parts = [`${minutes}分`];
  if (route.transitCount !== null) {
    parts.push(route.transitCount > 0 ? `乗換${route.transitCount}回` : "乗換なし");
  }

  const message = `Yahoo!乗換案内から取り込みました（${parts.join("・")}）。`;

  const searched = route.searchedDate;
  const month = Number(baseDate.slice(5, 7));
  const day = Number(baseDate.slice(8, 10));
  if (!searched || (searched.month === month && searched.day === day)) return message;

  return `${message} 検索されていたのは${searched.month}月${searched.day}日で、この移動の日（${month}月${day}日）とは違います。日付は変えていません。`;
}
