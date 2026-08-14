"use client";

import { Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RunningActivityItem } from "@/types/activity";

import { formatElapsed } from "./activity-format";
import { useNowIso } from "./use-clock";

/**
 * いましていることを記録するボタン（docs/spec.md §27）。
 *
 * 記録中は名前と経過時間を出すため、押す口であると同時に「いま何を記録しているか」の
 * 表示でもある。そのためオフラインでも隠さず、押せない状態にとどめる
 * （追加の「＋」は押せなければ意味が無いので隠すが、こちらは残しておく意味がある）。
 *
 * 追加の「＋」の上に重ねて置く。どちらもカレンダーへ足す操作で、
 * 離れた場所にあると、どちらを押すか決めるために目を動かすことになるため。
 */
export function ActivityButton({
  running,
  disabled,
  onOpen,
}: {
  running: RunningActivityItem | null;
  disabled: boolean;
  onOpen: () => void;
}) {
  const nowIso = useNowIso();

  return (
    <div className="fixed right-4 bottom-[calc(10.5rem_+_env(safe-area-inset-bottom))] z-30 md:bottom-[6.5rem]">
      <Button
        aria-label={running ? `記録中: ${running.title}` : "活動を記録"}
        disabled={disabled}
        onClick={onOpen}
        className={cn(
          "elevation-2 h-12 rounded-lg",
          running
            ? "gap-2 bg-primary-container pr-4 pl-3 text-on-primary-container"
            : "w-12 bg-surface-container-high px-0 text-on-surface-variant",
        )}
      >
        {running ? (
          <>
            {/* 動いていることを形でも示す。色だけでは、止め忘れているかどうかが分からない。 */}
            <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
            {/* 名前が長いときに削るのは名前の側。経過時間は幅が決まっており、
                削れると「いつから記録しているのか」が読めなくなる。 */}
            <span className="type-label-large max-w-32 truncate">{running.title}</span>
            {nowIso && (
              <span className="type-label-medium shrink-0 tabular-nums opacity-75">
                {formatElapsed(running.startedAt, nowIso)}
              </span>
            )}
          </>
        ) : (
          <Timer className="size-6" />
        )}
      </Button>
    </div>
  );
}
