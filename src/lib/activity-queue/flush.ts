"use client";

import {
  classifyResponse,
  expectedOf,
  logicalStart,
  nextSendable,
  rebaseExpected,
  applyPendingOps,
  type PendingOp,
  type SendOutcome,
} from "@/lib/activity-queue/ops";
import { readQueue, setSyncState, writeQueue } from "@/lib/activity-queue/store";
import type { RunningActivityItem } from "@/types/activity";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** 操作ひとつをサーバーへ送る。通信の失敗は例外で返る。 */
type Sent = {
  outcome: SendOutcome;
  /** 応答の記録（開始・開始時刻の修正）。 */
  running?: RunningActivityItem;
  /** サーバーが返した理由。画面へそのまま出す。 */
  message?: string;
};

async function sendOp(op: PendingOp): Promise<Sent> {
  let response: Response;

  switch (op.kind) {
    case "start":
      response = await fetch("/api/activities/start", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          presetId: op.presetId,
          title: op.presetId ? undefined : op.title,
          startedAt: op.at,
        }),
      });
      break;
    case "stop":
      response = await fetch("/api/activities/stop", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          endedAt: op.at,
          expectedStartedAt: op.expected.startedAt,
          expectedTitle: op.expected.title,
        }),
      });
      break;
    case "discard": {
      const params = new URLSearchParams({
        expectedStartedAt: op.expected.startedAt,
        expectedTitle: op.expected.title,
      });
      response = await fetch(`/api/activities/running?${params}`, { method: "DELETE" });
      break;
    }
    case "updateStart":
      response = await fetch("/api/activities/running", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          startedAt: op.startedAt,
          expectedStartedAt: op.expected.startedAt,
          expectedTitle: op.expected.title,
        }),
      });
      break;
  }

  const body = (await response.json().catch(() => null)) as
    | ({ error?: string; message?: string } & { running?: RunningActivityItem })
    | null;

  const outcome = classifyResponse(response.status, body);
  return { outcome, running: body?.running, message: body?.message ?? body?.error };
}

/** 同時に走らせない。複数のタブ・画面が同じ操作を二重に送るのを防ぐ。 */
async function withLock<T>(task: () => Promise<T>): Promise<T | null> {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request("dayspan:activity-queue", { ifAvailable: true }, async (lock) =>
      lock ? task() : null,
    );
  }
  return task();
}

export type FlushResult = {
  /** サーバーへ届いた（完了扱いを含む）操作があったか。画面を取り直す合図。 */
  changed: boolean;
};

/**
 * ためた操作を先頭から順にサーバーへ送る（issue #974）。
 *
 * 通信が戻ったとき・画面を開いたとき・操作を積んだときに呼ぶ。保留中の操作があれば、順序を
 * 守るためそこで止まる。ステータスコードではなく応答の `error` の値で次の動きを決める
 * （classifyResponse）。
 */
export async function flushActivityQueue(): Promise<FlushResult> {
  const result = await withLock(async (): Promise<FlushResult> => {
    let changed = false;
    setSyncState({ flushing: true });

    try {
      for (;;) {
        const op = nextSendable(readQueue());
        if (!op) break;

        let sent: Sent;
        try {
          sent = await sendOp(op);
        } catch {
          // 通信が戻っていない。残して次の機会に再試行する。
          break;
        }

        const { outcome } = sent;

        if (outcome.type === "retry") {
          setSyncState({ authRequired: Boolean(outcome.authRequired) });
          break;
        }
        setSyncState({ authRequired: false });

        if (outcome.type === "hold") {
          writeQueue(
            readQueue().map((o) => (o.id === op.id ? { ...o, heldReason: outcome.message } : o)),
          );
          break;
        }

        if (outcome.type === "future_time") {
          if (op.kind === "updateStart") {
            writeQueue(
              readQueue().map((o) =>
                o.id === op.id
                  ? { ...o, heldReason: "端末の時計が進んでいるため、開始時刻を同期できませんでした。" }
                  : o,
              ),
            );
            break;
          }
          // 時刻の指定を外し、サーバーの時計で送り直す。端末の時計の進みを記録へ持ち込まない。
          // 論理上の開始時刻は変わらないため、前提条件の直しは成功後に行う。
          writeQueue(
            readQueue().map((o) => (o.id === op.id ? { ...o, at: undefined } : o)),
          );
          continue;
        }

        // done / gone: 先頭を外す。開始系は、サーバーが実際に決めた開始時刻へ後ろの前提を直す。
        let rest = readQueue().filter((o) => o.id !== op.id);
        const logical = logicalStart(op);
        if (outcome.type === "done" && logical && sent.running) {
          rest = rebaseExpected(rest, logical, sent.running.startedAt);
        }
        writeQueue(rest);
        changed = true;
      }
    } finally {
      setSyncState({ flushing: false });
    }

    return { changed };
  });

  return result ?? { changed: false };
}

export type SubmitInput =
  | { kind: "start"; presetId?: string; title: string; at?: string }
  | { kind: "stop"; at?: string }
  | { kind: "discard" }
  | { kind: "updateStart"; startedAt: string };

export type SubmitResult =
  /** サーバーへ届いた。応答の記録（開始・開始時刻の修正）があれば添える。 */
  | { status: "done"; running?: RunningActivityItem }
  /** 端末にためた。通信が戻ると同期する。 */
  | { status: "queued" }
  /** サーバーが断った。理由をそのまま画面へ出す。 */
  | { status: "error"; message: string };

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 画面からの記録の操作を受け付ける（issue #974）。
 *
 * オンラインで、ためている操作も無ければ、従来どおりその場でサーバーへ送る（時刻はサーバーの時計）。
 * オフライン中・通信の失敗・先にためた操作があるときは、端末の時刻を添えてキューへ積む。
 * 先にためた操作があるのにその場で送ると、順序が入れ替わって別の記録を止めてしまう。
 *
 * 前提条件（どの記録への操作か）は、積む直前の「見かけの記録」から作る。
 */
export async function submitActivityOp(
  input: SubmitInput,
  serverRunning: { title: string; startedAt: string } | null,
  offline: boolean,
): Promise<SubmitResult> {
  const queue = readQueue();
  const appearing = applyPendingOps(serverRunning, queue);
  const expected = expectedOf(appearing);

  if ((input.kind === "stop" || input.kind === "discard" || input.kind === "updateStart") && !expected) {
    return { status: "error", message: "記録中のものがありません。" };
  }

  const createdAt = new Date().toISOString();
  const base = { id: newId(), createdAt };

  const build = (withClientTime: boolean): PendingOp => {
    switch (input.kind) {
      case "start":
        return {
          ...base,
          kind: "start",
          presetId: input.presetId,
          title: input.title,
          at: input.at ?? (withClientTime ? createdAt : undefined),
        };
      case "stop":
        return {
          ...base,
          kind: "stop",
          expected: expected!,
          at: input.at ?? (withClientTime ? createdAt : undefined),
        };
      case "discard":
        return { ...base, kind: "discard", expected: expected! };
      case "updateStart":
        return { ...base, kind: "updateStart", startedAt: input.startedAt, expected: expected! };
    }
  };

  const offlineNow = offline || (typeof navigator !== "undefined" && navigator.onLine === false);

  // 先にためた操作があるとき、または通信が無いとき。積んで、送れるなら送る。
  if (offlineNow || queue.length > 0) {
    writeQueue([...queue, build(true)]);
    if (!offlineNow) await flushActivityQueue();
    return readQueue().length === 0 ? { status: "done" } : { status: "queued" };
  }

  // 通常の経路。積んでから送ることで、通信が途中で切れた操作もそのまま残る。
  const op = build(false);
  writeQueue([op]);
  const sentOp = op;

  let sent: Sent;
  try {
    sent = await sendOp(sentOp);
  } catch {
    // 届かなかった。端末の時刻を添えて積んだまま残す。
    writeQueue(readQueue().map((o) => (o.id === op.id ? withClientTime(o, createdAt) : o)));
    return { status: "queued" };
  }

  const { outcome } = sent;
  if (outcome.type === "done" || outcome.type === "gone") {
    writeQueue(readQueue().filter((o) => o.id !== op.id));
    return { status: "done", running: sent.running };
  }

  // 応答は届いたがサーバーが応えられない（Googleへの書き出しの失敗など）。従来どおり理由を出し、
  // 積み残さない。積んでしまうと、利用者から見えないまま再送が続く。
  if (outcome.type === "retry" && !outcome.authRequired) {
    writeQueue(readQueue().filter((o) => o.id !== op.id));
    return { status: "error", message: sent.message ?? "サーバーが応答できませんでした。" };
  }

  if (outcome.type === "retry") {
    writeQueue(readQueue().map((o) => (o.id === op.id ? withClientTime(o, createdAt) : o)));
    setSyncState({ authRequired: Boolean(outcome.authRequired) });
    return { status: "queued" };
  }

  // 断られた。その場の操作は積み残さず、理由を画面へ出す。
  writeQueue(readQueue().filter((o) => o.id !== op.id));
  return {
    status: "error",
    message:
      outcome.type === "hold"
        ? outcome.message
        : "端末の時計が進んでいるため、時刻を受け付けられませんでした。",
  };
}

function withClientTime(op: PendingOp, at: string): PendingOp {
  if (op.kind === "start" || op.kind === "stop") return { ...op, at: op.at ?? at };
  return op;
}
