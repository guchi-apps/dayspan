import { AppFrameSkeleton, BottomNavSkeleton, SkeletonBlock } from "@/components/calendar/calendar-skeleton";
import { WIDE_SECTION_CARD_CLASS } from "@/components/ui/wide-section";
import { cn } from "@/lib/utils";

/**
 * タスクの骨組み。広い画面では実物と同じく、サイドバーと区分のカードの格子にする（issue #636）。
 * 4つ目の区分は4列に並ぶ幅でだけ出す（狭い画面の骨組みの長さは従来のまま）。
 */
export default function Loading() {
  return (
    <AppFrameSkeleton>
      <div className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <SkeletonBlock className="size-8 rounded-full lg:hidden" />
        <SkeletonBlock className="h-6 w-20" />
        <span className="flex-1" />
        <SkeletonBlock className="h-8 w-20 rounded-full" />
      </div>

      <div className="h-1 w-full overflow-hidden bg-secondary-container">
        <div className="h-full w-2/5 animate-[linear-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden @2xl/main:grid @2xl/main:grid-cols-2 @2xl/main:content-start @2xl/main:items-start @2xl/main:gap-3 @2xl/main:p-3 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }, (_, section) => (
          <div
            key={section}
            className={cn(WIDE_SECTION_CARD_CLASS, section === 3 && "hidden @5xl/main:block")}
          >
            <div className="bg-surface-container px-4 py-2">
              <SkeletonBlock className="h-4 w-16" />
            </div>
            {Array.from({ length: 3 }, (_, row) => (
              <div key={row} className="flex items-start gap-3 px-4 py-3">
                <SkeletonBlock className="size-4 rounded-xs" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <SkeletonBlock className="h-4 w-2/3" />
                  <SkeletonBlock className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <BottomNavSkeleton />
    </AppFrameSkeleton>
  );
}
