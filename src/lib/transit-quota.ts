// 経路検索API（NAVITIME）の利用枠を画面に出すための型と、描画から切り離した計算。
//
// 数えているのはDaySpanではなくtrainroute（docs/spec.md §29「経路検索の利用状況」）。
// ここにあるのは受け取った値の読み替えだけで、取得は src/services/trainroute/client.ts が行う。
//
// 型をサービス側ではなくここに置くのは、入力画面（クライアントコンポーネント）とサーバー側の
// 両方から使うため。サービスは接続先URLとトークンを読むので、画面側から辿らせない。

import { isoToLocalInput } from "@/components/calendar/datetime-fields";

export type TransitQuota = {
  /** 提供元の識別子。DaySpanはこの値で分岐しない（提供元を替えても画面を直さずに済む）。 */
  key: string;
  /** 画面に出す名前（"NAVITIME"）。 */
  label: string;
  /** 枠の上限。分からなければ null（残り回数だけを出す）。 */
  limit: number | null;
  /** 残り回数。 */
  remaining: number;
  /** 枠が戻る日時（ISO 8601）。分からなければ null。 */
  resetAt: string | null;
  /** trainrouteが最後に残数を見た時刻（ISO 8601）。 */
  updatedAt: string | null;
  /**
   * provider … 提供元（RapidAPI）が応答に付けた残数そのもの。
   * local … trainrouteが自分の呼び出しを数えた概算。他の呼び出し元の分は含まない。
   */
  source: "provider" | "local";
};

/**
 * 「残りわずか」に切り替わる境目。
 *
 * 移動を作るのは多くて日に数回で、1日5回として10日ぶん残っている段階で気付ける値にする。
 * 使い切ってから気付くと、リセットまでの間ずっと電車の所要時間がAIの目安に戻る。
 */
export const QUOTA_LOW_REMAINING = 50;

/** 使った回数。上限が分からないときは求められない。 */
export function quotaUsed(quota: TransitQuota): number | null {
  if (quota.limit === null) return null;
  return Math.max(0, quota.limit - quota.remaining);
}

/**
 * 目盛りの割合（0〜100）。上限が分からない・0のときは目盛りを出さない。
 *
 * 小数第1位まで丸めるのは、この値がそのまま `width` として要素に載るため
 * （37/500 は 7.3999999999999995 になる）。整数まで落とさないのは、使い始めの数回が
 * 0%として消えないようにするため。
 */
export function quotaPercent(quota: TransitQuota): number | null {
  const used = quotaUsed(quota);
  if (used === null || !quota.limit) return null;
  const percent = Math.min(100, Math.max(0, (used / quota.limit) * 100));
  return Math.round(percent * 10) / 10;
}

export function isQuotaLow(quota: TransitQuota): boolean {
  return quota.remaining <= QUOTA_LOW_REMAINING;
}

export function isQuotaExhausted(quota: TransitQuota): boolean {
  return quota.remaining <= 0;
}

/**
 * 「9月3日」。
 *
 * 解釈は `UiSetting.timeZone` で固定する。実行環境のローカル時刻に依存させると、
 * サーバー（UTC）とブラウザ（JST）で描画がずれてハイドレーションが一致しない。
 */
export function formatQuotaDate(iso: string | null, timeZone: string): string | null {
  const local = toLocalInput(iso, timeZone);
  if (!local) return null;
  return `${Number(local.slice(5, 7))}月${Number(local.slice(8, 10))}日`;
}

/** 「8月27日 12:40」。最終更新に使う。 */
export function formatQuotaDateTime(iso: string | null, timeZone: string): string | null {
  const local = toLocalInput(iso, timeZone);
  if (!local) return null;
  return `${formatQuotaDate(iso, timeZone)} ${local.slice(11, 16)}`;
}

function toLocalInput(iso: string | null, timeZone: string): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return isoToLocalInput(iso, timeZone);
}
