import { cn } from "@/lib/utils";

/**
 * M3のリニアプログレスインジケーター（不確定）。
 * 押した操作がサーバーの応答待ちであることを、押した直後に示すために使う。
 */
export function LinearProgress({ active, className }: { active: boolean; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-hidden={!active}
      aria-label="読み込み中"
      className={cn(
        "h-1 w-full shrink-0 overflow-hidden bg-secondary-container transition-opacity",
        active ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <div
        className={cn(
          "h-full w-2/5 rounded-full bg-primary",
          active && "animate-[linear-progress_1.1s_ease-in-out_infinite]",
        )}
      />
    </div>
  );
}
