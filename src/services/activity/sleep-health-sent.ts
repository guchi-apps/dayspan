import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { SleepHealthPlan, SleepHealthSentRecord } from "@/lib/sleep-health";

/**
 * ヘルスケアへ送った睡眠の履歴（docs/spec.md §40「送ったあとの変更」）。
 *
 * ショートカットにはヘルスケアの既存サンプルを更新・削除するアクションが無く、追加しかできない。
 * 送ったあとに時刻を直した・消した睡眠を見つけるには、何をいつの時刻で送ったかを持つ必要がある。
 * 持つのはGoogleの予定IDごとの、送った時点の開始・終了だけ。
 *
 * 履歴を進めるのは**送り終えたあと**（POST）だけにする。GETの時点で進めると、ヘルスケアの
 * 書き込み許可を出していない等で途中で止まったとき、送っていない睡眠が送ったことになる
 * （送り終えた印 `SleepHealthExport.exportedUntil` と同じ理由）。GETが返した内容は控えとして
 * `SleepHealthExport.pending` へ置き、POSTがそれを確定する。
 */

/** GETが返した内容の控え。POSTの `until` が一致したときだけ履歴へ反映する。 */
type PendingPayload = {
  /** GETが返した `until`（ISO 8601）。POSTの本文と突き合わせる。 */
  until: string;
  /** 追加で送った睡眠。履歴へ書く（すでにあれば送った時刻を置き換える）。 */
  items: { eventId: string; start: string; end: string }[];
  /** 履歴から外す予定ID（削除・項目名の変更・ヘルスケア由来への変更）。 */
  goneEventIds: string[];
  /** これより前に終わった履歴は掃除する（編集を探す範囲の外）。 */
  pruneBefore: string;
};

/** 編集を探す範囲に終わりがかかる履歴を読む。 */
export async function listSleepHealthSent(
  userId: string,
  since: Date,
): Promise<SleepHealthSentRecord[]> {
  const rows = await db.sleepHealthSent.findMany({
    where: { userId, end: { gt: since } },
    select: { eventId: true, start: true, end: true },
  });

  return rows;
}

/**
 * GETが返した内容を控えとして置く。やること（追加も履歴の整理も）が無ければ控えは消す。
 *
 * `goneEventIds` は `plan.stale` のうち予定が無くなったものだけ。時刻を直した睡眠は
 * `items` の上書きで新しい時刻に置き換わるため、外す必要が無い。
 */
export async function savePendingSleepHealth(
  userId: string,
  input: { plan: SleepHealthPlan; until: string; pruneBefore: Date },
): Promise<void> {
  const { plan, until, pruneBefore } = input;

  const sendingIds = new Set(plan.items.map((item) => item.eventId));
  const goneEventIds = plan.stale
    .map((item) => item.eventId)
    .filter((eventId) => !sendingIds.has(eventId));

  const hasWork = plan.items.length > 0 || goneEventIds.length > 0;
  const payload: PendingPayload = {
    until,
    items: plan.items.map((item) => ({
      eventId: item.eventId,
      start: new Date(item.startMs).toISOString(),
      end: new Date(item.endMs).toISOString(),
    })),
    goneEventIds,
    pruneBefore: pruneBefore.toISOString(),
  };

  const pending = hasWork ? (payload as Prisma.InputJsonValue) : Prisma.DbNull;
  // 行が無くてもトークン（ショートカット）の有無に関わらず置く
  await db.sleepHealthExport.upsert({
    where: { userId },
    create: { userId, pending },
    update: { pending },
  });
}

/**
 * 送り終えたと伝えられたとき、控えを履歴へ反映する。反映したかを返す。
 *
 * `until` が控えと一致しなければ何もしない（別のGETの控えを、古い実行のPOSTが確定して
 * しまうのを避ける。範囲を指定して送ったときのように控えが無いときも何もしない）。
 * 同時に2回走ると控えが上書きされうるが、履歴がずれるのは送った睡眠の重複の可否だけで、
 * 稀なため許容している。
 */
export async function commitPendingSleepHealth(userId: string, until: Date): Promise<boolean> {
  const row = await db.sleepHealthExport.findUnique({
    where: { userId },
    select: { pending: true },
  });

  const pending = row?.pending as PendingPayload | null | undefined;
  if (!pending || new Date(pending.until).getTime() !== until.getTime()) return false;

  await db.$transaction([
    ...pending.items.map((item) =>
      db.sleepHealthSent.upsert({
        where: { userId_eventId: { userId, eventId: item.eventId } },
        create: {
          userId,
          eventId: item.eventId,
          start: new Date(item.start),
          end: new Date(item.end),
        },
        update: { start: new Date(item.start), end: new Date(item.end), sentAt: new Date() },
      }),
    ),
    db.sleepHealthSent.deleteMany({ where: { userId, eventId: { in: pending.goneEventIds } } }),
    db.sleepHealthSent.deleteMany({ where: { userId, end: { lte: new Date(pending.pruneBefore) } } }),
    db.sleepHealthExport.updateMany({ where: { userId }, data: { pending: Prisma.DbNull } }),
  ]);

  return true;
}

/**
 * ヘルスケアへ送り終えた睡眠の終わり（docs/spec.md §40「ヘルスケアへ送る」）。未送信なら null。
 *
 * ユーザーに1つ。取得した時点では進めず、書き終えたあとの確定でだけ進める。
 */
export async function getSleepHealthExportedUntil(userId: string): Promise<Date | null> {
  const row = await db.sleepHealthExport.findUnique({
    where: { userId },
    select: { exportedUntil: true },
  });

  return row?.exportedUntil ?? null;
}

/**
 * 送り終えた印を進める。戻しはしない（`until` が今の印より前なら何もしない）。
 *
 * 同じ取得の結果で確定が2回走った・古い取得の結果が後から届いた、のどちらでも、
 * 印が戻って送り済みの睡眠がもう一度返ることを避ける。
 */
export async function markSleepHealthExported(userId: string, until: Date): Promise<Date | null> {
  await db.sleepHealthExport.upsert({
    where: { userId },
    create: { userId, exportedUntil: until },
    update: {},
  });
  await db.sleepHealthExport.updateMany({
    where: { userId, OR: [{ exportedUntil: null }, { exportedUntil: { lt: until } }] },
    data: { exportedUntil: until },
  });

  return getSleepHealthExportedUntil(userId);
}
