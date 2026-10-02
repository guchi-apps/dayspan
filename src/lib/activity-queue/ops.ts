// 活動記録のオフライン操作（issue #974）。ブラウザにも DB にも触れない純粋なロジックだけを置く
// （`node --test` で確かめるため）。保存・送信は queue-store.ts / flush.ts が受け持つ。

import type { RunningActivityItem } from "@/types/activity";

/** 操作が向けられた記録。サーバーへは前提条件として添え、違う記録への操作を断らせる。 */
export type ExpectedRecord = { startedAt: string; title: string };

type OpBase = {
  id: string;
  /** 操作した瞬間の端末の時刻（ISO 8601）。 */
  createdAt: string;
  /**
   * サーバーへ送る時刻の指定（開始・終了・直した開始）。
   * 未指定ならサーバーの時計で決める（オンライン中の通常の操作）。オフライン中に積んだ操作と、
   * 通信の失敗で積み直した操作だけが入る（端末の時計は信用しきれないため、使うのは
   * サーバーの時計が使えないときに限る）。
   */
  at?: string;
  /** 送信を保留している理由。利用者が再試行か破棄を選ぶまで、後ろの操作も送らない。 */
  heldReason?: string;
};

export type PendingOp =
  | (OpBase & { kind: "start"; presetId?: string; title: string })
  | (OpBase & { kind: "stop"; expected: ExpectedRecord })
  | (OpBase & { kind: "discard"; expected: ExpectedRecord })
  | (OpBase & { kind: "updateStart"; startedAt: string; expected: ExpectedRecord });

/** この操作が記録の開始時刻として画面へ示す時刻。 */
export function logicalStart(op: PendingOp): string | null {
  if (op.kind === "start") return op.at ?? op.createdAt;
  if (op.kind === "updateStart") return op.startedAt;
  return null;
}

/**
 * サーバーの記録に、まだ送っていない操作を順に重ねた「いまの見かけ」の記録。
 * オフライン中の画面・記録中バーはこれを出す。保留中の操作も、利用者が意図した状態として重ねる。
 */
export function applyPendingOps<T extends { title: string; startedAt: string }>(
  running: T | null,
  ops: PendingOp[],
): T | RunningActivityItem | null {
  let current: T | RunningActivityItem | null = running;

  for (const op of ops) {
    switch (op.kind) {
      case "start":
        current = {
          title: op.title,
          calendarId: running && "calendarId" in running ? String(running.calendarId) : "",
          startedAt: op.at ?? op.createdAt,
        };
        break;
      case "stop":
      case "discard":
        current = null;
        break;
      case "updateStart":
        if (current) current = { ...current, startedAt: op.startedAt } as T | RunningActivityItem;
        break;
    }
  }

  return current;
}

/**
 * 後ろの操作が前提にしている開始時刻を、サーバーが実際に決めた時刻へ直す。
 *
 * 開始・開始時刻の修正は、サーバーが時刻を丸める（未来の端数）ことや、時刻を送らずサーバーの時計で
 * 決めさせることがある。後ろの停止・取消が前提条件に端末で見積もった時刻を持ったままだと、
 * 実際の記録と食い違って「他の端末で処理済み」と誤判定し、止めるべき記録が止まらない。
 */
export function rebaseExpected(ops: PendingOp[], from: string, to: string): PendingOp[] {
  if (from === to) return ops;
  const fromMs = Date.parse(from);

  return ops.map((op) => {
    if (op.kind === "start") return op;
    if (Date.parse(op.expected.startedAt) !== fromMs) return op;
    return { ...op, expected: { ...op.expected, startedAt: to } };
  });
}

/** 送信結果の分類。画面の文面ではなく、次にどう動くかだけを持つ。 */
export type SendOutcome =
  | { type: "done"; startedAt?: string }
  /** 他の端末で処理済み（not_running・record_changed）。完了扱いにして次へ進む。 */
  | { type: "gone" }
  /** 通信不達・401・5xx。キューに残して次の機会に再試行する。 */
  | { type: "retry"; authRequired?: boolean }
  /** 端末の時計が進んでいた。時刻の指定を外し、サーバーの時計で送り直す。 */
  | { type: "future_time" }
  /** 自動では解決できない。理由を出して利用者の判断を待つ。 */
  | { type: "hold"; message: string };

type ErrorBody = { error?: string; message?: string } | null;

/** 応答のステータスと `error` の値から次の動きを決める。ステータスだけでは決めない。 */
export function classifyResponse(status: number, body: ErrorBody): SendOutcome {
  const code = body?.error;

  if (status >= 200 && status < 300) return { type: "done" };
  if (code === "not_running" || code === "record_changed") return { type: "gone" };
  if (code === "future_time") return { type: "future_time" };

  if (status === 401) return { type: "retry", authRequired: true };
  if (status >= 500) return { type: "retry" };

  const reason =
    code === "before_running"
      ? "他の端末があとから始めた記録と重なっているため、自動では同期できません。"
      : (body?.message ?? "同期できませんでした。");
  return { type: "hold", message: reason };
}

/** 先頭から送れる操作。保留中の操作があれば、順序を守るためそこで止まる。 */
export function nextSendable(ops: PendingOp[]): PendingOp | null {
  const head = ops[0];
  if (!head || head.heldReason) return null;
  return head;
}

/** 操作を積む。直前までの見かけの記録から、前提条件を作る。 */
export function expectedOf(
  running: { title: string; startedAt: string } | null,
): ExpectedRecord | null {
  return running ? { startedAt: running.startedAt, title: running.title } : null;
}
